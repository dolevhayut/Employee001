// Embeddings-ON benchmark — exercises the two paths the keyword-only run could
// not: (B') HYBRID retrieval (keyword + semantic + salience fusion) and (D')
// real dedup-on-write against paraphrases. Requires OPENAI_API_KEY in the env.
// Run from a temp cwd. No LLM grading — all metrics computed in code.
import fs from "fs";
import path from "path";

const REPO = "/Users/dolevhayut/Documents/GitHub/Employee001-public";
const BENCH = path.join(REPO, ".memory-bench");
const tm = await import(path.join(REPO, "src/lib/twin-memory.ts"));
const round = (n, d = 3) => Number(n.toFixed(d));
const norm = (s) => (s ?? "").replace(/\s+/g, " ").trim();

if (!process.env.OPENAI_API_KEY) { console.error("NO OPENAI_API_KEY"); process.exit(1); }

// ─────────────── B' — Hybrid retrieval (embeddings on) ──────────────────────
async function hybridRetrieval() {
  const { cards, queries } = JSON.parse(fs.readFileSync(path.join(BENCH, "retrieval-gold.json"), "utf8"));
  const emp = "retHybrid";
  // Seed via rememberTwinRun so every card gets a REAL embedding.
  for (const card of cards) {
    await tm.rememberTwinRun({
      employeeId: emp, runId: `c${card.idx}`, surface: "chat",
      question: card.question, answer: card.answer,
    });
  }
  const qToIdx = new Map(cards.map((c) => [norm(c.question), c.idx]));
  const accessFile = path.join(process.cwd(), "data", "memory", emp, "access.json");

  let nP = 0, sumP5 = 0, sumR5 = 0, sumMRR = 0, emptyTotal = 0, emptyClean = 0;
  const hard = { n: 0, r5: 0 }, easy = { n: 0, r5: 0 };
  for (const q of queries) {
    fs.rmSync(accessFile, { force: true }); // isolate queries
    const hits = await tm.searchTwinMemory(emp, q.q, cards.length);
    const ranked = hits.map((h) => qToIdx.get(norm(h.card.question))).filter((i) => i !== undefined);
    const rel = new Set(q.relevant);
    if (rel.size === 0) {
      emptyTotal++;
      // With semantic on, every card scores >0; "clean" = top hit weakly related.
      if ((hits[0]?.score ?? 0) < 0.02) emptyClean++;
      continue;
    }
    const top5 = ranked.slice(0, 5);
    const inTop5 = top5.filter((i) => rel.has(i)).length;
    let mrr = 0;
    for (let r = 0; r < ranked.length; r++) if (rel.has(ranked[r])) { mrr = 1 / (r + 1); break; }
    nP++; sumP5 += inTop5 / 5; sumR5 += inTop5 / rel.size; sumMRR += mrr;
    (q.hard ? hard : easy).n++; (q.hard ? hard : easy).r5 += inTop5 / rel.size;
  }
  const avg = (s, n) => (n ? round(s / n) : null);
  return {
    queriesScored: nP,
    precisionAt5: avg(sumP5, nP), recallAt5: avg(sumR5, nP), mrr: avg(sumMRR, nP),
    hardRecallAt5: avg(hard.r5, hard.n), easyRecallAt5: avg(easy.r5, easy.n),
    emptyRelevantAbstention: `${emptyClean}/${emptyTotal}`,
  };
}

// ─────────────── D' — Dedup-on-write against real paraphrases ───────────────
async function realDedup() {
  const emp = "dedupReal";
  const cardsFile = path.join(process.cwd(), "data", "memory", emp, "cards.jsonl");
  const accessFile = path.join(process.cwd(), "data", "memory", emp, "access.json");
  const count = () => (fs.existsSync(cardsFile) ? fs.readFileSync(cardsFile, "utf8").trim().split("\n").filter(Boolean).length : 0);
  const accessEntries = () => (fs.existsSync(accessFile) ? Object.values(JSON.parse(fs.readFileSync(accessFile, "utf8"))) : []);

  // A — original.
  await tm.rememberTwinRun({ employeeId: emp, runId: "A", surface: "chat",
    question: "Which database did we pick for analytics?",
    answer: "We decided to go with Postgres for the analytics service." });
  const afterA = count();
  // B — paraphrase of A (different words, same meaning) → should DEDUP (reinforce, not append).
  await tm.rememberTwinRun({ employeeId: emp, runId: "B", surface: "chat",
    question: "What DB are we using for analytics?",
    answer: "We chose Postgres to power the analytics service." });
  const afterB = count();
  // C — clearly distinct topic → should APPEND.
  await tm.rememberTwinRun({ employeeId: emp, runId: "C", surface: "chat",
    question: "How do we deploy the app?",
    answer: "We use GitHub Actions to build and deploy on every tag." });
  const afterC = count();
  // D — near-miss: same domain words but different fact → should APPEND (not over-merge).
  await tm.rememberTwinRun({ employeeId: emp, runId: "D", surface: "chat",
    question: "Which database did we pick for billing?",
    answer: "We decided to use MySQL for the billing service, not Postgres." });
  const afterD = count();

  return {
    afterA, afterB, afterC, afterD,
    paraphraseDeduped: afterB === afterA,            // B merged into A
    paraphraseReinforced: accessEntries().some((e) => e.count >= 1),
    distinctTopicAppended: afterC === afterB + 1,    // C is its own card
    sameDomainDifferentFactAppended: afterD === afterC + 1, // D not over-merged
  };
}

const results = { hybridRetrieval: await hybridRetrieval(), realDedup: await realDedup() };
fs.writeFileSync(path.join(BENCH, "results-embed.json"), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
