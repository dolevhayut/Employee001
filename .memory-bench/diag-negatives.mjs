import fs from "fs";
import path from "path";
const REPO = "/Users/dolevhayut/Documents/GitHub/Employee001-public";
const tm = await import(path.join(REPO, "src/lib/twin-memory.ts"));
const { cases } = JSON.parse(fs.readFileSync(path.join(REPO, ".memory-bench/extraction-gold.json"), "utf8"));
for (const c of cases.filter((c) => c.mustExtractNothing)) {
  const emp = `diag-${c.id}`;
  await tm.rememberTwinRun({ employeeId: emp, runId: c.id, surface: "chat", question: c.question ?? "", answer: c.answer ?? "" });
  const f = path.join(process.cwd(), "data", "memory", emp, "structured.jsonl");
  const ex = fs.existsSync(f) ? fs.readFileSync(f, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
  if (ex.length) {
    console.log(`FALSE-FIRE ${c.id} — ${c.note}`);
    console.log(`   text: ${(c.question || "")} | ${(c.answer || "")}`);
    ex.forEach((e) => console.log(`   -> [${e.type}] "${e.value}"`));
  }
}
