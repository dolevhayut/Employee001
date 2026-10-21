// Admin allowlist for reads that leave the machine (see ReadAllowlist in
// tool-policy.ts). Stored in data/org/read-allowlist.json; edited by
// admin/owner only. The first load seeds it from what the admin had already
// connected (enabled org MCP servers, employees' active Composio toolkits)
// so existing setups keep working, and records the seed in the audit log.

import "server-only";
import fs from "fs";
import path from "path";
import { dataDir } from "./app-home";
import { appendAuditEntry } from "./audit-log";
import type { ReadAllowlist } from "./tool-policy";

const FILE = () => dataDir("org", "read-allowlist.json");
const SLUG = /^[a-z0-9][a-z0-9_-]{0,63}$/;

type Stored = ReadAllowlist & { updatedAt?: string; updatedBy?: string };

export function normalizeReadAllowlist(raw: unknown): ReadAllowlist {
  const v = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const list = (x: unknown) => [...new Set((Array.isArray(x) ? x : []).filter((s): s is string => typeof s === "string").map((s) => s.trim().toLowerCase()).filter((s) => SLUG.test(s)))];
  return {
    servers: list(v.servers),
    composioToolkits: list(v.composioToolkits),
    webSearch: v.webSearch === true,
    webOverrides: v.webOverrides === true,
  };
}

function write(value: Stored): void {
  const file = FILE();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, file);
}

function sanitizeKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
}

/** What the admin had connected before the allowlist existed. */
function seed(): ReadAllowlist {
  const servers: string[] = [];
  try {
    const cfg = JSON.parse(fs.readFileSync(dataDir("org", "custom-mcp.json"), "utf8")) as { servers?: Array<{ name?: string; enabled?: boolean }> };
    for (const s of cfg.servers ?? []) if (s.enabled && s.name) servers.push(sanitizeKey(s.name));
  } catch { /* no org MCP servers */ }
  const toolkits: string[] = [];
  try {
    for (const id of fs.readdirSync(dataDir("employees"))) {
      try {
        const state = JSON.parse(fs.readFileSync(dataDir("employees", id, ".composio.json"), "utf8")) as { connections?: Record<string, { status?: string }> };
        for (const [toolkit, c] of Object.entries(state.connections ?? {})) {
          if (String(c?.status ?? "").toLowerCase() === "active") toolkits.push(toolkit);
        }
      } catch { /* no connections */ }
    }
  } catch { /* no employees */ }
  return normalizeReadAllowlist({ servers, composioToolkits: toolkits, webSearch: false, webOverrides: false });
}

export function loadReadAllowlist(): ReadAllowlist {
  try {
    return normalizeReadAllowlist(JSON.parse(fs.readFileSync(FILE(), "utf8")));
  } catch {
    const seeded = seed();
    try {
      write({ ...seeded, updatedAt: new Date().toISOString(), updatedBy: "migration" });
      appendAuditEntry({
        runId: `migration-${Date.now()}`,
        employeeId: "system",
        employeeName: "system",
        toolName: "readAllowlistSeeded",
        bareName: "readAllowlistSeeded",
        input: { ...seeded },
        verdict: "executed",
      });
    } catch { /* read-only data dir: run with the seed in memory */ }
    return seeded;
  }
}

export function saveReadAllowlist(raw: unknown, updatedBy: string): ReadAllowlist {
  const value = normalizeReadAllowlist(raw);
  write({ ...value, updatedAt: new Date().toISOString(), updatedBy });
  appendAuditEntry({
    runId: `settings-${Date.now()}`,
    employeeId: "system",
    employeeName: "system",
    toolName: "readAllowlistUpdated",
    bareName: "readAllowlistUpdated",
    input: { ...value },
    verdict: "executed",
    approvedBy: updatedBy,
    approvalChannel: "ui",
  });
  return value;
}
