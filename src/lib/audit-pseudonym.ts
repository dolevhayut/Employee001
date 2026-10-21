// Stable pseudonyms for deleted employees in the audit log. Employee ids are
// name-derived slugs ("noa-friedman"), so keeping them after a deletion keeps
// the name. A keyed hash (HMAC-SHA256 under a per-install secret) gives the
// same pseudonym every time, so rows still group by person, while the slug
// can't be recovered by guessing names without the key.

import { createHmac, randomBytes } from "node:crypto";
import fs from "fs";
import path from "path";
import { dataDir } from "./app-home";

const SALT_FILE = () => dataDir(".audit-pseudonym-key");

function installKey(): Buffer {
  const file = SALT_FILE();
  try {
    const existing = fs.readFileSync(file);
    if (existing.length >= 32) return existing;
  } catch { /* first use */ }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const key = randomBytes(32);
  // wx: never overwrite a key another process just wrote.
  try {
    fs.writeFileSync(file, key, { mode: 0o600, flag: "wx" });
    return key;
  } catch {
    return fs.readFileSync(file);
  }
}

export function isPseudonym(id: string): boolean {
  return /^emp_[0-9a-f]{16}$/.test(id);
}

export function pseudonymFor(employeeId: string): string {
  if (isPseudonym(employeeId)) return employeeId;
  return `emp_${createHmac("sha256", installKey()).update(employeeId).digest("hex").slice(0, 16)}`;
}
