import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { verifyAuditLines } from "../lib/audit-verify.mjs";

const USAGE = `Usage:
  employee001 audit verify            Verify the audit hash chain in ./data (or $EMPLOYEE001_HOME/data)
  employee001 audit verify <file>     Verify an exported log (GET /api/audit/export)
`;

function chainLinesFromDataDir(dataDir) {
  const archives = existsSync(dataDir)
    ? readdirSync(dataDir).filter((n) => /^audit\.\d{4}-\d{2}\.jsonl$/.test(n)).sort()
    : [];
  return [...archives, "audit.jsonl"]
    .map((n) => join(dataDir, n))
    .filter((f) => existsSync(f))
    .flatMap((f) => readFileSync(f, "utf8").split("\n").filter(Boolean));
}

export default async function audit(args) {
  const [sub, file] = args;
  if (sub !== "verify") {
    process.stdout.write(USAGE);
    process.exitCode = sub ? 1 : 0;
    return;
  }
  const lines = file
    ? readFileSync(resolve(file), "utf8").split("\n").filter(Boolean)
    : chainLinesFromDataDir(resolve(process.env.EMPLOYEE001_HOME ?? process.cwd(), "data"));
  if (!lines.length) {
    process.stdout.write("No audit rows found.\n");
    return;
  }
  const result = verifyAuditLines(lines);
  if (result.ok) {
    process.stdout.write(`✓ Audit chain intact: ${result.checked} rows verified${result.legacy ? `, ${result.legacy} legacy rows before the chain started` : ""}.\n`);
  } else {
    process.stdout.write(`✗ Audit chain broken after ${result.checked} rows: ${result.reason}${result.firstBadId ? ` (row ${result.firstBadId})` : ""}.\n`);
    process.exitCode = 2;
  }
}
