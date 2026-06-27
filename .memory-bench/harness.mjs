// Deterministic benchmark harness for the twin-memory layer.
// Runs from a TEMP cwd (so data/memory writes don't touch the repo), importing
// the module by absolute path. No LLM grading — all metrics are computed in code.
import fs from "fs";
import path from "path";

const REPO = "/Users/dolevhayut/Documents/GitHub/Employee001-public";
const BENCH = path.join(REPO, ".memory-bench");
const tm = await import(path.join(REPO, "src/lib/twin-memory.ts"));

const round = (n, d = 3) => Number(n.toFixed(d));
const tokens = (s) =>
  (s.toLowerCase().match(/[\p{L}\p{N}_-]{2,}/gu) ?? []);

// ───────────────────────── Suite A — Extraction ─────────────────────────────
// Per gold fact: matched if an extracted fact shares the type AND >= half the
// gist tokens appear in the extracted value. Negatives: any extraction = FP.
async function suiteExtraction() {
  const { cases } = JSON.parse(fs.readFileSync(path.join(BENCH, "extraction-gold.json"), "utf8"));
  let goldTotal = 0, goldHit = 0;
  let negCases = 0, negClean = 0, negSpurious = 0;
  let posSpurious = 0; // extracted facts on positive cases whose type is not in gold types
  const byLang = {}; // lang -> {gold, hit}
  const misses = [];

  for (const c of cases) {
    const emp = `exA-${c.id}`;
    await tm.rememberTwinRun({
      employeeId: emp, runId: c.id, surface: "chat",
      question: c.question ?? "", answer: c.answer ?? "",
    });
    const file = path.join(process.cwd(), "data", "memory", emp, "structured.jsonl");
    const extracted = fs.existsSync(file)
      ? fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l))
      : [];

    if (c.mustExtractNothing) {
      negCases++;
      if (extracted.length === 0) negClean++;
      else negSpurious += extracted.length;
      continue;
    }

    const goldTypes = new Set(c.expected.map((e) => e.type));
    byLang[c.lang] ??= { gold: 0, hit: 0 };
    for (const g of c.expected) {
      goldTotal++; byLang[c.lang].gold++;
      const gistTok = tokens(g.gist);
      const need = Math.max(1, Math.ceil(gistTok.length / 2));
      const matched = extracted.some((f) => {
        if (f.type !== g.type) return false;
        const valTok = tokens(f.value);
        // Substring-tolerant token match: handles Hebrew morphology (clitic
        // prefixes like לְ-/הַ-/בְּ- mean gist token "ניהול" must still match the
        // value token "לניהול") plus light English stemming. Language-agnostic —
        // applied uniformly to every case, not just Hebrew.
        const overlap = gistTok.filter((t) =>
          valTok.some(
            (v) =>
              v === t ||
              (t.length >= 3 && v.length >= 3 && (v.includes(t) || t.includes(v)))
          )
        ).length;
        return overlap >= need;
      });
      if (matched) { goldHit++; byLang[c.lang].hit++; }
      else misses.push({ id: c.id, type: g.type, gist: g.gist, lang: c.lang });
    }
    posSpurious += extracted.filter((f) => !goldTypes.has(f.type)).length;
  }

  return {
    overallRecall: round(goldHit / goldTotal),
    goldHit, goldTotal,
    negativePrecision: round(negClean / negCases), // fraction of negatives correctly yielding nothing
    negativesClean: `${negClean}/${negCases}`,
    falsePositiveFactsOnNegatives: negSpurious,
    spuriousTypeFactsOnPositives: posSpurious,
    recallByLang: Object.fromEntries(
      Object.entries(byLang).map(([k, v]) => [k, `${round(v.hit / v.gold)} (${v.hit}/${v.gold})`])
    ),
    sampleMisses: misses.slice(0, 8),
  };
}

// ───────────────────────── Suite B — Retrieval ──────────────────────────────
async function suiteRetrieval() {
  const { cards, queries } = JSON.parse(fs.readFileSync(path.join(BENCH, "retrieval-gold.json"), "utf8"));
  const emp = "retB";
  // Seed cards.jsonl DIRECTLY with deterministic ids + spaced timestamps, so
  // results are reproducible and realistic (memories accrue over time, not in a
  // single millisecond). Avoids random UUIDs and ms-level createdAt noise that
  // would otherwise break the many coarse keyword-score ties nondeterministically.
  const dir = path.join(process.cwd(), "data", "memory", emp);
  fs.mkdirSync(dir, { recursive: true });
  const EPOCH = Date.UTC(2026, 0, 1);
  const lines = cards.map((card) =>
    JSON.stringify({
      id: `card-${card.idx}`,
      employeeId: emp,
      runId: `c${card.idx}`,
      surface: "chat",
      content: `CEO asked: ${card.question}\nTwin answered: ${card.answer}`,
      question: card.question,
      answerPreview: card.answer,
      importance: 1,
      // idx 0 oldest → idx N newest, spaced 1h apart. Distinct + deterministic.
      createdAt: new Date(EPOCH + card.idx * 3600_000).toISOString(),
    })
  );
  fs.writeFileSync(path.join(dir, "cards.jsonl"), lines.join("\n") + "\n");
  const idOf = (h) => {
    const m = /^card-(\d+)$/.exec(h.card.id);
    return m ? Number(m[1]) : undefined;
  };

  let nP = 0, sumP5 = 0, sumR5 = 0, sumMRR = 0;
  let emptyTotal = 0, emptyClean = 0;
  const perHard = { hard: { n: 0, p5: 0, r5: 0 }, easy: { n: 0, p5: 0, r5: 0 } };

  // Reset reinforcement before each query so cross-query recall doesn't leak
  // (searchTwinMemory reinforces hits, which would make later queries depend on
  // earlier ones). Each query is scored against the same clean seeded corpus.
  const accessFile = path.join(process.cwd(), "data", "memory", emp, "access.json");
  for (const q of queries) {
    fs.rmSync(accessFile, { force: true });
    const hits = await tm.searchTwinMemory(emp, q.q, cards.length); // full ranking
    const rankedIdx = hits.map(idOf).filter((i) => i !== undefined);
    const rel = new Set(q.relevant);

    if (rel.size === 0) {
      emptyTotal++;
      // No abstention in the API; "clean" = top hit has zero lexical signal.
      if ((hits[0]?.keywordScore ?? 0) === 0) emptyClean++;
      continue;
    }

    const top5 = rankedIdx.slice(0, 5);
    const relInTop5 = top5.filter((i) => rel.has(i)).length;
    const p5 = relInTop5 / 5;
    const r5 = relInTop5 / rel.size;
    let mrr = 0;
    for (let r = 0; r < rankedIdx.length; r++) {
      if (rel.has(rankedIdx[r])) { mrr = 1 / (r + 1); break; }
    }
    nP++; sumP5 += p5; sumR5 += r5; sumMRR += mrr;
    const bucket = q.hard ? perHard.hard : perHard.easy;
    bucket.n++; bucket.p5 += p5; bucket.r5 += r5;
  }

  const avg = (s, n) => (n ? round(s / n) : null);
  return {
    queriesScored: nP,
    precisionAt5: avg(sumP5, nP),
    recallAt5: avg(sumR5, nP),
    mrr: avg(sumMRR, nP),
    hard: { n: perHard.hard.n, P5: avg(perHard.hard.p5, perHard.hard.n), R5: avg(perHard.hard.r5, perHard.hard.n) },
    easy: { n: perHard.easy.n, P5: avg(perHard.easy.p5, perHard.easy.n), R5: avg(perHard.easy.r5, perHard.easy.n) },
    emptyRelevant: `${emptyClean}/${emptyTotal} returned no lexically-matching top hit`,
  };
}

// ─────────────────── Suite C — Salience dynamics (math) ─────────────────────
function suiteSalience() {
  const now = Date.now();
  const DAY = 86400000;
  const card = (id, ageDays) => ({ id, importance: 1, createdAt: new Date(now - ageDays * DAY).toISOString() });
  const acc = (count, lastAgeDays) => ({ count, lastAccessedAt: new Date(now - lastAgeDays * DAY).toISOString() });

  const checks = [];
  const assert = (name, cond, detail) => checks.push({ name, pass: !!cond, detail });

  // 1. Fresh-cold vs stale-cold: fresher decays less.
  const freshCold = tm.salience(card("f", 0), {}, now);
  const staleCold = tm.salience(card("s", 60), {}, now);
  assert("fresh card > 60-day-stale card (decay)", freshCold > staleCold, { freshCold: round(freshCold), staleCold: round(staleCold) });

  // 2. Reinforced-old beats cold-fresh when the old card is kept warm by recall.
  const oldWarm = tm.salience(card("ow", 60), { ow: acc(20, 0) }, now);
  assert("60-day card reinforced 20x (last touched today) > fresh-cold", oldWarm > freshCold, { oldWarm: round(oldWarm), freshCold: round(freshCold) });

  // 3. Monotonic in access count (age held constant, last touch today).
  const r0 = tm.salience(card("a", 5), { a: acc(0, 0) }, now);
  const r5 = tm.salience(card("a", 5), { a: acc(5, 0) }, now);
  const r50 = tm.salience(card("a", 5), { a: acc(50, 0) }, now);
  assert("salience monotonic in recall count", r0 < r5 && r5 < r50, { r0: round(r0), r5: round(r5), r50: round(r50) });

  // 4. Diminishing returns (log): jump 0->5 bigger than 45->50.
  assert("reinforcement has diminishing returns (log curve)", (r5 - r0) > (r50 - tm.salience(card("a", 5), { a: acc(45, 0) }, now)), {});

  // 5. Half-life: untouched card at 14 days ≈ 0.5 of base.
  const halfLife = tm.salience(card("h", 14), {}, now);
  assert("untouched card at 14d half-life ≈ 0.5×base", Math.abs(halfLife - 0.5) < 0.02, { value: round(halfLife) });

  // 6. Pipeline influence: with identical keyword content, a heavily reinforced
  //    card must outrank a cold one end-to-end through searchTwinMemory ordering.
  return { checks, allPass: checks.every((c) => c.pass) };
}

async function suiteSaliencePipeline() {
  // Two cards with identical matchable content; one reinforced, one cold.
  const emp = "salC";
  const dir = path.join(process.cwd(), "data", "memory", emp);
  fs.mkdirSync(dir, { recursive: true });
  const now = Date.now();
  const mk = (id, ageDays) => ({
    id, employeeId: emp, runId: id, surface: "chat",
    content: "CEO asked: deployment rollback procedure\nTwin answered: run the rollback playbook for deployment",
    question: "deployment rollback procedure", answerPreview: "run the rollback playbook for deployment",
    importance: 1, createdAt: new Date(now - ageDays * 86400000).toISOString(),
  });
  fs.writeFileSync(path.join(dir, "cards.jsonl"),
    JSON.stringify(mk("cold-fresh", 1)) + "\n" + JSON.stringify(mk("warm-old", 40)) + "\n");
  fs.writeFileSync(path.join(dir, "access.json"),
    JSON.stringify({ "warm-old": { count: 40, lastAccessedAt: new Date(now).toISOString() } }));

  const hits = await tm.searchTwinMemory(emp, "deployment rollback procedure", 2);
  const top = hits[0]?.card.id;
  return {
    topCardId: top,
    reinforcedWins: top === "warm-old",
    scores: hits.map((h) => ({ id: h.card.id, score: round(h.score, 4), kw: round(h.keywordScore), sal: round(h.salienceScore, 3) })),
  };
}

// ─────────────────── Suite D — Dedup policy (math) ──────────────────────────
function suiteDedup() {
  const DIM = 256;
  // Deterministic pseudo-random base vector (seeded LCG).
  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff - 0.5;
  const base = Array.from({ length: DIM }, rnd);
  const perturb = (v, eps) => v.map((x) => x + (rnd() * 2 - 1) * eps);
  const THRESHOLD = 0.92;

  const cos = tm.cosineSimilarity;
  const sims = [0.01, 0.05, 0.1, 0.2, 0.4].map((eps) => ({ eps, sim: round(cos(base, perturb(base, eps)), 4) }));
  // Distinct vector (independent random) should be well below threshold.
  const distinct = Array.from({ length: DIM }, rnd);
  const distinctSim = round(cos(base, distinct), 4);

  // Monotonic: more perturbation -> lower similarity.
  const monotonic = sims.every((s, i) => i === 0 || s.sim <= sims[i - 1].sim + 1e-9);
  // A small perturbation stays a "duplicate", a large one does not.
  const nearDupCaught = cos(base, perturb(base, 0.02)) >= THRESHOLD;
  const distinctRejected = distinctSim < THRESHOLD;

  return {
    threshold: THRESHOLD,
    similarityVsPerturbation: sims,
    distinctPairSim: distinctSim,
    monotonicDecay: monotonic,
    nearDuplicateCaught: nearDupCaught,
    distinctPairRejected: distinctRejected,
    allPass: monotonic && nearDupCaught && distinctRejected,
  };
}

// ───────────────────────────── Run all ──────────────────────────────────────
const results = {
  extraction: await suiteExtraction(),
  retrieval: await suiteRetrieval(),
  salienceMath: suiteSalience(),
  saliencePipeline: await suiteSaliencePipeline(),
  dedupPolicy: suiteDedup(),
};
fs.writeFileSync(path.join(BENCH, "results.json"), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
