// Re-grade earlier runs' retired-twin answers with the current judge, without
// re-running interviews. Compare runs graded the same way:
//   RELAY_EVAL_REGRADE=docs/local/evals/run-a,docs/local/evals/run-b npm run eval:relay -- regrade
// Skipped unless RELAY_EVAL_REGRADE is set.

import fs from "node:fs";
import path from "node:path";
import { describe, it } from "vitest";
import { loadWorld, dossierFor } from "./companysim";
import { judgeAnswer, groundTruthText, type AnswerVerdict, type HiddenKnowledge } from "./agents";

type Saved = { personId: string; name: string; qa: { question: string; expected: string | null; answer: string }[] };

const dirs = (process.env.RELAY_EVAL_REGRADE ?? "").split(",").filter(Boolean);

describe.skipIf(dirs.length === 0)("Relay eval re-grade", () => {
  it("re-grades retired-twin answers with the current judge", async () => {
    const world = await loadWorld();
    const lines: string[] = ["| Run | Person | Correct | Partial | Abstained | Wrong | Abstained when it should |", "|---|---|---|---|---|---|---|"];
    for (const dir of dirs) {
      const saved = JSON.parse(fs.readFileSync(path.join(dir, "report.json"), "utf8")) as Saved[];
      const out: (Saved & { regraded: AnswerVerdict[] })[] = [];
      for (const r of saved) {
        const knowledge = JSON.parse(fs.readFileSync(path.join(dir, "..", "fixtures", `${r.personId}.json`), "utf8")) as HiddenKnowledge;
        const truth = groundTruthText(dossierFor(world, r.personId), knowledge);
        const regraded = await Promise.all(r.qa.map((q) => judgeAnswer(q.question, q.expected, q.answer, truth)));
        out.push({ ...r, regraded });
        const count = (v: AnswerVerdict["verdict"]) => regraded.filter((g, i) => r.qa[i].expected && g.verdict === v).length;
        const abstainOk = regraded.some((g, i) => !r.qa[i].expected && g.verdict === "abstained");
        lines.push(`| ${path.basename(dir)} | ${r.name} | ${count("correct")}/${r.qa.filter((q) => q.expected).length} | ${count("partial")} | ${count("abstained")} | ${count("wrong")} | ${abstainOk ? "yes" : "no"} |`);
      }
      fs.writeFileSync(path.join(dir, "regrade.json"), JSON.stringify(out, null, 2));
    }
    console.log(lines.join("\n"));
  });
});
