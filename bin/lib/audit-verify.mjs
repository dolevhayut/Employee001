// Offline verifier for the Employee001 audit log (hash chain). The same
// algorithm as verifyAuditLines in src/lib/audit-log.ts, in plain JS so the
// CLI and auditors can check an exported log without the app. A test in
// src/lib/audit-verify-cli.test.ts keeps the two in step.

import { createHash } from "node:crypto";

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
const canonicalJson = (value) => stableJson(JSON.parse(JSON.stringify(value)));
const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const digestInput = (input) => sha256(canonicalJson(input));
const digestName = (name) => sha256(name ?? "");

function legacyPin(row) {
  const rest = { ...row };
  delete rest.input;
  delete rest.employeeName;
  delete rest.redacted;
  delete rest.hash;
  return sha256(canonicalJson(rest));
}

function hashedPayload(row) {
  const payload = { ...row };
  delete payload.redacted;
  if (payload.inputDigest) {
    delete payload.input;
    delete payload.employeeName;
  }
  if (payload.idDigest) delete payload.employeeId;
  return payload;
}

const hashRow = (prevHash, row) => sha256(`${prevHash}\n${canonicalJson(hashedPayload(row))}`);

/** @param {string[]} lines JSONL rows in chain order */
export function verifyAuditLines(lines) {
  let checked = 0;
  let legacy = 0;
  let previous = "genesis";
  let chainStarted = false;
  const pending = new Map();
  const bad = (row, reason) => ({ ok: false, checked, legacy, ...(row ? { firstBadId: row.id } : {}), reason });

  for (const line of lines) {
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      return bad(null, "invalid JSON row");
    }
    if (!row.hash || !row.prevHash) {
      if (!chainStarted) {
        legacy++;
        continue;
      }
      return bad(row, "missing hash fields after chain start");
    }
    const unsignedRow = { ...row };
    delete unsignedRow.hash;
    if (row.prevHash !== previous) return bad(row, "previous hash mismatch");
    const hashOk = row.hash === hashRow(row.prevHash, unsignedRow);
    const contentCheckable = !row.redacted || (Boolean(row.inputDigest) && hashOk);
    if (!row.redacted && !hashOk) return bad(row, "hash mismatch");
    if (!row.redacted && row.inputDigest && row.inputDigest !== digestInput(row.input ?? {})) return bad(row, "hash mismatch");
    if (!row.redacted && row.nameDigest && row.nameDigest !== digestName(row.employeeName)) return bad(row, "hash mismatch");
    if (!row.redacted && row.idDigest && row.idDigest !== digestName(row.employeeId)) return bad(row, "hash mismatch");
    if (row.redacted) {
      if (row.bareName === "purgeEmployee") return bad(row, "redacted purge record");
      pending.set(row.id, { employeeId: row.employeeId, pin: contentCheckable ? undefined : legacyPin(row) });
    } else if (row.bareName === "purgeEmployee" && row.inputDigest) {
      const pins = row.input?.legacyPins ?? {};
      for (const id of Array.isArray(row.input?.redactedIds) ? row.input.redactedIds : []) {
        if (typeof id !== "string") continue;
        const seen = pending.get(id);
        if (!seen || seen.employeeId !== row.employeeId) continue;
        if (seen.pin && pins[id] !== seen.pin) continue;
        pending.delete(id);
      }
    }
    chainStarted = true;
    previous = row.hash;
    checked++;
  }
  const orphan = pending.keys().next().value;
  if (orphan) return { ok: false, checked, legacy, firstBadId: orphan, reason: "redacted row without a purge record" };
  return { ok: true, checked, legacy };
}
