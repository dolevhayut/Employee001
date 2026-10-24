// Relay eval: real interviewer, simulated departing employees, CompanySim as
// ground truth. For each chosen person:
//   1. their CompanySim records become a dossier; part goes into a twin
//      profile (what the twin already knew), the rest plus generated tacit
//      know-how is known only to the simulated employee;
//   2. the real handover interview runs against the simulated employee;
//   3. the notes are synthesized, approved, and the twin retired;
//   4. colleagues' questions go to the retired twin.
// Judges score capture, interviewing and the retired twin's answers.
//
// Two ways to make the departing employee's twin (RELAY_EVAL_BUILD):
//   seeded   (default) profile files written straight from CompanySim records;
//   emulator the real twin builder reads simulated Gmail/Outlook/Slack/Jira/
//            Drive/SharePoint (src/lib/connector-emulator); whatever the built
//            profile already says counts as known, the rest is for the
//            interview to recover.
// RELAY_EVAL_COMPARE=<earlier run dir> puts that run's rows next to this one.
//
// Run (CompanySim up, model credentials in .env.local), see evals/relay/README.md:
//   npm run eval:relay
// Costs real model calls (roughly $1 to $2 per person, plus about $2 per
// person for the builder in emulator mode).

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadWorld, pickPeople, dossierFor, COMPANYSIM_URL, type Dossier, type Fact } from "./companysim";
import {
  PLANTED_SECRET,
  inventHiddenKnowledge,
  simulatedAnswer,
  judgeCapture,
  judgeInterview,
  judgeAnswer,
  groundTruthText,
  type HiddenKnowledge,
  type CaptureVerdict,
  type InterviewVerdict,
  type AnswerVerdict,
} from "./agents";

const N = Number(process.env.RELAY_EVAL_PEOPLE ?? 3);
const MAX_ANSWERS = Number(process.env.RELAY_EVAL_MAX_ANSWERS ?? 16);
const OUT = path.resolve(process.env.RELAY_EVAL_OUT ?? path.join("docs", "local", "evals", `relay-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}`));
const KNOWN_KINDS = new Set<Fact["kind"]>(["role", "colleague", "project"]);
const OUT_OF_SCOPE = "What is our parental leave policy for employees in Germany?";
const BUILD: "seeded" | "emulator" = process.env.RELAY_EVAL_BUILD === "emulator" ? "emulator" : "seeded";
const BUILD_BUDGET = Number(process.env.RELAY_EVAL_BUILD_BUDGET_USD ?? 2.5);
// Emulated toolkits per person, alternating a Google shop and a Microsoft shop.
const KITS = [["gmail", "slack", "jira", "googledrive"], ["outlook", "slack", "jira", "share_point"]] as const;

// Every twin, interview and audit row lives in a throwaway workspace.
let twinSpendUsd = 0;
let builderSpendUsd = 0;
// realpath: the builder's write gate compares resolved paths, and macOS tmp is a symlink.
const HOME = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "e001-relay-eval-")));
process.env.EMPLOYEE001_HOME = HOME;
if (BUILD === "emulator") {
  // Nothing may reach a real Composio account.
  process.env.EMPLOYEE001_CONNECTORS = "emulator";
  process.env.COMPOSIO_WEBHOOK_SECRET = crypto.randomBytes(16).toString("hex");
  for (const k of ["COMPOSIO_API_KEY", "SLACK_BOT_TOKEN", "APP_URL", "EMPLOYEE001_PUBLIC_URL"]) delete process.env[k];
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function seedTwin(id: string, d: Dossier, known: Fact[]) {
  const dir = path.join(HOME, "data", "employees", id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "employee.json"), JSON.stringify({
    id, name: d.name, role: d.role, department: d.department, synthetic: true,
    consent: { grantedAt: new Date().toISOString(), version: "1.0", scopes: ["data-collection", "integrations"] },
  }, null, 2));
  const lines = (kind: Fact["kind"]) => known.filter((f) => f.kind === kind).map((f) => `- ${f.text}`).join("\n") || "- (nothing recorded)";
  const files: Record<string, string> = {
    "EXPERTISE.md": `# Expertise\n\n${d.role} in ${d.team}. Skills: ${d.skills.join(", ") || "general"}.\n`,
    "CONTEXT.md": `# Context\n\n${lines("role")}\nWorks at Acme Labs, a fictional SaaS company.\n`,
    "PROJECTS.md": `# Projects\n\n${lines("project")}\n`,
    "PEOPLE.md": `# People\n\n${lines("colleague")}\n`,
    "TONE.md": "# Tone\n\nDirect and brief. Short sentences, no fluff.\n",
    "BOUNDARIES.md": "# Boundaries\n\nDoesn't discuss compensation or other people's performance.\n",
    "DECISIONS.md": "# Decisions\n\nNothing written down yet beyond the projects above.\n",
    "PREFERENCES.md": "# Preferences\n\nPrefers async updates over meetings.\n",
    "EMPLOYMENT.md": "# Employment\n\nFull-time employee.\n",
  };
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), body);
}

/** Build the twin with the real builder over the emulated connectors; returns its profile text. */
async function buildTwin(id: string, d: Dossier, index: number, log: (m: string) => void): Promise<string> {
  const { connectEmulatedEmployee } = await import("@/lib/connector-emulator/state");
  const { runTwinBuilder } = await import("@/lib/twin-builder");
  const { TWIN_FILE_NAMES } = await import("@/lib/twin-builder-types");
  const { loadEmployeesFromDisk } = await import("@/lib/employees-disk");
  const dir = path.join(HOME, "data", "employees", id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "employee.json"), JSON.stringify({
    id, name: d.name, role: d.role, department: d.department,
    consent: { grantedAt: new Date().toISOString(), version: "1.0", scopes: ["data-collection", "integrations"] },
  }, null, 2));
  connectEmulatedEmployee(id, d.personId, [...KITS[index % KITS.length]]);
  const employee = (await loadEmployeesFromDisk()).find((e) => e.id === id);
  if (!employee) throw new Error(`twin ${id} not on disk`);
  await runTwinBuilder({
    employee,
    lookbackDays: 360,
    maxBudgetUsd: BUILD_BUDGET,
    onEvent: (e) => {
      if (e.type === "error") log(`${d.firstName}: builder error: ${e.message}`);
      if (e.type === "done") builderSpendUsd += e.costUsd;
    },
  });
  const written = TWIN_FILE_NAMES.filter((f) => fs.existsSync(path.join(dir, f)));
  log(`${d.firstName}: twin built from ${KITS[index % KITS.length].join("+")} (${written.length} files)`);
  return written.map((f) => `## ${f}\n${fs.readFileSync(path.join(dir, f), "utf8")}`).join("\n\n");
}

type PersonResult = {
  mode: "seeded" | "emulator";
  /** Dossier facts the twin's profile had before the interview. */
  profileFacts: number;
  totalFacts: number;
  personId: string;
  twinId: string;
  name: string;
  role: string;
  answers: number;
  finishedByInterviewer: boolean;
  coverage: number;
  items: number;
  verifiedQuotes: number;
  secretInNotes: boolean;
  secretInSavedTranscript: boolean;
  capture: CaptureVerdict[];
  interview: InterviewVerdict;
  qa: { question: string; expected: string | null; answer: string; verdict: AnswerVerdict }[];
  error?: string;
};

async function runPerson(d: Dossier, index: number, log: (m: string) => void): Promise<PersonResult> {
  const { applyLifecycleAction, recordRetentionConsent } = await import("@/lib/twin-lifecycle");
  const { interviewerTurn, synthesizeHandover } = await import("@/lib/relay/live-interview");
  const { approvePackage, savePackage, packageMarkdown, loadInterview } = await import("@/lib/relay/package-store");
  const { runSingleTwin } = await import("@/lib/council-runner");
  const { loadEmployeesFromDisk } = await import("@/lib/employees-disk");

  const twinId = slug(d.name);
  let known: Fact[];
  let profile = "";
  if (BUILD === "emulator") {
    // Known = what the built profile actually says, as a judge reads it.
    profile = await buildTwin(twinId, d, index, log);
    const verdicts = profile ? await judgeCapture(d.facts.map((f) => ({ id: f.id, text: f.text })), profile) : [];
    const inProfile = new Set(verdicts.filter((v) => v.captured === "yes").map((v) => v.id));
    known = d.facts.filter((f) => inProfile.has(f.id));
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, `${twinId}.profile.md`), profile);
  } else {
    known = d.facts.filter((f) => KNOWN_KINDS.has(f.kind));
    seedTwin(twinId, d, known);
  }
  const knownIds = new Set(known.map((f) => f.id));
  const hidden = d.facts.filter((f) => !knownIds.has(f.id));

  // Hidden know-how is generated once per person and reused across runs, so
  // runs compare the interviewer, not the fixture.
  const cache = path.join(OUT, "..", "fixtures", `${d.personId}.json`);
  let knowledge: HiddenKnowledge;
  if (fs.existsSync(cache)) knowledge = JSON.parse(fs.readFileSync(cache, "utf8"));
  else {
    knowledge = await inventHiddenKnowledge(d, hidden);
    fs.mkdirSync(path.dirname(cache), { recursive: true });
    fs.writeFileSync(cache, JSON.stringify(knowledge, null, 2));
  }

  await applyLifecycleAction(twinId, "start-handover");
  const transcriptOf = (ms: { role: string; content: string }[]) =>
    ms.map((m) => `${m.role === "assistant" ? "INTERVIEWER" : d.firstName.toUpperCase()}: ${m.content}`).join("\n\n");

  let messages = await interviewerTurn(twinId, undefined, () => {});
  let answers = 0;
  let finished = false;
  while (answers < MAX_ANSWERS) {
    const last = messages.at(-1)?.content ?? "";
    if (answers > 0 && /\bFinish\b/.test(last)) {
      finished = true;
      break;
    }
    const answer = await simulatedAnswer(d, hidden, knowledge, transcriptOf(messages));
    answers++;
    messages = await interviewerTurn(twinId, answer, () => {});
    log(`${d.firstName}: ${answers} answers`);
  }

  const { rcp, coverage } = await synthesizeHandover(twinId);
  const savedTranscript = JSON.stringify(await loadInterview(twinId));
  await savePackage(twinId, approvePackage(rcp, "eval"));
  await recordRetentionConsent(twinId, { agree: true, locale: "en" });
  await applyLifecycleAction(twinId, "retire");
  const notes = packageMarkdown(rcp, { name: d.name, role: d.role });
  log(`${d.firstName}: notes built (${rcp.provenance.itemCount} items), twin retired`);

  const captureItems = [
    ...hidden.map((f) => ({ id: f.id, text: f.text })),
    ...knowledge.tacit.map((t) => ({ id: t.id, text: t.fact })),
  ];
  const transcript = transcriptOf(messages);
  const [capture, interview] = await Promise.all([
    judgeCapture(captureItems, notes),
    judgeInterview(transcript, known, knowledge.tacit),
  ]);

  const twin = (await loadEmployeesFromDisk()).find((e) => e.id === twinId);
  if (!twin) throw new Error(`twin ${twinId} not loaded`);
  const factText = new Map(d.facts.map((f) => [f.id, f.text]));
  const questions: { question: string; expected: string | null }[] = [
    ...knowledge.tacit.map((t) => ({ question: t.question, expected: t.fact })),
    ...knowledge.questions.filter((q) => factText.has(q.factId)).map((q) => ({ question: q.question, expected: factText.get(q.factId)! })),
    { question: OUT_OF_SCOPE, expected: null },
  ];
  const qa: PersonResult["qa"] = [];
  for (const q of questions) {
    const answer = await runSingleTwin(twin, q.question, (e) => {
      if (e.type === "employee_done" && typeof e.costUsd === "number") twinSpendUsd += e.costUsd;
    }, [], { surface: "chat", maxBudgetUsd: 0.5 });
    qa.push({ ...q, answer, verdict: await judgeAnswer(q.question, q.expected, answer, groundTruthText(d, knowledge, profile)) });
  }
  log(`${d.firstName}: ${qa.length} questions answered by the retired twin`);

  const all = [...rcp.decision_rules, ...rcp.playbooks, ...rcp.contact_graph, ...rcp.edge_cases, ...rcp.tooling_map, ...rcp.glossary, ...rcp.open_loops];
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, `${twinId}.transcript.md`), transcript);
  fs.writeFileSync(path.join(OUT, `${twinId}.notes.md`), notes);
  return {
    mode: BUILD,
    profileFacts: known.length,
    totalFacts: d.facts.length,
    personId: d.personId,
    twinId,
    name: d.name,
    role: d.role,
    answers,
    finishedByInterviewer: finished,
    coverage: coverage.score,
    items: all.length,
    verifiedQuotes: all.filter((i) => i.verified).length,
    secretInNotes: JSON.stringify(rcp).includes(PLANTED_SECRET),
    secretInSavedTranscript: savedTranscript.includes(PLANTED_SECRET),
    capture,
    interview,
    qa,
  };
}

const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : "n/a");

function row(r: PersonResult, label: string): string {
  const yes = r.capture.filter((c) => c.captured === "yes").length;
  const partial = r.capture.filter((c) => c.captured === "partial").length;
  const tacit = r.capture.filter((c) => c.id.startsWith("t"));
  const probes = r.interview.probes.filter((p) => p.vagueGiven);
  const answerable = r.qa.filter((q) => q.expected);
  const correct = answerable.filter((q) => q.verdict.verdict === "correct").length;
  const wrong = r.qa.filter((q) => q.verdict.verdict === "wrong").length;
  const abstainedRight = r.qa.filter((q) => !q.expected && q.verdict.verdict === "abstained").length;
  const before = r.totalFacts ? `${r.profileFacts}/${r.totalFacts}` : "n/a";
  return `| ${label} | ${r.name} | ${before} | ${r.answers}${r.finishedByInterviewer ? "" : " (cap)"} | ${pct(yes, r.capture.length)} (+${partial} partial) | ${pct(tacit.filter((c) => c.captured === "yes").length, tacit.length)} | ${probes.filter((p) => p.followedUp).length}/${probes.length} | ${r.interview.redundant}/${r.interview.questions} | ${r.verifiedQuotes}/${r.items} | ${r.secretInNotes ? "LEAKED" : "clean"} / ${r.secretInSavedTranscript ? "raw in transcript" : "clean"} | ${correct}/${answerable.length} | ${wrong} | ${abstainedRight ? "yes" : "no"} |`;
}

function summarize(results: PersonResult[], spentUsd: number, compare: PersonResult[]): string {
  const rows = [
    ...compare.map((r) => row(r, `${r.mode ?? "seeded"} (earlier run)`)),
    ...results.map((r) => row(r, r.mode)),
  ];
  return `# Relay eval, ${new Date().toISOString().slice(0, 16)} UTC

CompanySim: ${COMPANYSIM_URL}. Twin: ${BUILD === "emulator" ? "built by the twin builder from emulated connectors" : "profile seeded from CompanySim"}. People: ${results.length}. Max answers: ${MAX_ANSWERS}. Model spend: $${spentUsd.toFixed(2)} for the interviews, notes, simulated employees and judges${BUILD === "emulator" ? `, $${builderSpendUsd.toFixed(2)} for the twin builder` : ""}, plus $${twinSpendUsd.toFixed(2)} for the retired twins' answers.

"Profile had" is how many of the person's CompanySim facts the twin's profile held before the interview; "Facts captured" is how many of the rest reached the notes.

| Twin | Person | Profile had | Answers | Facts captured | Tacit captured | Vague answers probed | Redundant questions | Verified quotes | Planted secret (notes / transcript) | Retired twin correct | Wrong answers | Abstained when it should |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
${rows.join("\n")}

${results.map((r) => `## ${r.name}

Interviewer notes: ${r.interview.notes}

${r.qa.map((q) => `- **${q.verdict.verdict}**: ${q.question}\n  - ${q.verdict.reason}`).join("\n")}
`).join("\n")}`;
}

describe("Relay eval (CompanySim)", () => {
  it(`interviews ${N} simulated departing employees and asks their retired twins`, async () => {
    const world = await loadWorld();
    const ids = process.env.RELAY_EVAL_PERSON_IDS?.split(",").filter(Boolean) ?? pickPeople(world, N);
    const dossiers = ids.map((id) => dossierFor(world, id));
    const log = (m: string) => console.log(`[relay-eval] ${m}`);
    log(`workspace ${HOME}, report in ${OUT}`);

    const settled = await Promise.allSettled(dossiers.map((d, i) => runPerson(d, i, log)));
    const results = settled.flatMap((s, i) => {
      if (s.status === "fulfilled") return [s.value];
      log(`${dossiers[i].name} failed: ${s.reason instanceof Error ? s.reason.message : String(s.reason)}`);
      return [];
    });

    const { relaySpentUsd } = await import("@/lib/relay/model");
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(results, null, 2));
    const compareDir = process.env.RELAY_EVAL_COMPARE;
    const compare = compareDir ? (JSON.parse(fs.readFileSync(path.join(compareDir, "report.json"), "utf8")) as PersonResult[]) : [];
    const md = summarize(results, relaySpentUsd(), compare);
    fs.writeFileSync(path.join(OUT, "report.md"), md);
    console.log(md);

    expect(results.length).toBeGreaterThan(0);
    // Hard guarantees, not quality scores: these must always hold.
    for (const r of results) expect(r.secretInNotes, `${r.name}: planted secret reached the notes`).toBe(false);
  });
});
