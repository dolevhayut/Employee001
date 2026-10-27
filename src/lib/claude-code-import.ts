// Server-only. Opt-in "Import from your Claude Code".
//
// Brings a person's Claude Code skills, http/sse MCP servers and CLAUDE.md /
// rules into Employee001. Two steps, both started by the person: preview()
// reads and lists exactly what would be imported (writes nothing); apply()
// re-reads, refuses if the result differs from the digest the person saw, then
// writes and audits.
//
// Security boundary: this module opens ONLY these paths under the source dir
//   skills/<name>/SKILL.md   CLAUDE.md   rules/**/*.md
// plus the `mcpServers` key of the sibling `.claude.json`, from which it keeps
// only `type` and `url`. It never opens settings.json, settings.local.json or
// .credentials.json, so hooks, permissions, env values and credentials cannot
// reach the import. MCP headers/env are never copied; credentials embedded in
// a URL (userinfo, query string, fragment) are stripped.

import fs from "fs";
import os from "os";
import path from "path";
import { createHash } from "node:crypto";
import { appendAuditEntry } from "./audit-log";
import { createCustomMcp, listCustomMcp, previewKey } from "./custom-mcp";
import { listKnowledgeFiles, writeKnowledgeFile } from "./knowledge-files";
import { loadEmployeesFromDisk } from "./employees-disk";
import { getHiredEmployees } from "./hired-agents";
import {
  getAssignedOrgSkillIdsForEmployee,
  importOrgSkillMarkdown,
  readOrgSkill,
  setAssignedOrgSkillIds,
} from "./org-skills";

const MAX_FILE_BYTES = 256 * 1024;
const MAX_CLAUDE_JSON_BYTES = 16 * 1024 * 1024; // ~/.claude.json carries project history
const MAX_ITEMS_PER_KIND = 200;
const MAX_RULE_DEPTH = 4;

export type ImportStatus = "new" | "update" | "exists";

export type SkillItem = { kind: "skill"; id: string; label: string; status: ImportStatus; content: string };
export type McpItem = { kind: "mcp"; name: string; transport: "http" | "sse"; url: string; status: ImportStatus; note?: string };
export type KnowledgeItem = { kind: "knowledge"; source: string; name: string; status: ImportStatus; bytes: number; content: string };
export type ImportItem = SkillItem | McpItem | KnowledgeItem;

export type ImportPreview = {
  sourcePath: string;
  /** Plain-words warning shown with the preview. */
  notice: string;
  items: ImportItem[];
  counts: { skills: number; mcpServers: number; knowledge: number };
  /** Things found but not imported, with the reason (never their content). */
  skipped: Array<{ what: string; reason: string }>;
  /** Hash of the importable items; apply must present the one the person saw. */
  digest: string;
};

export type ImportResult = {
  imported: { skills: number; mcpServers: number; knowledge: number };
  skippedExisting: number;
  auditRecorded: boolean;
};

/** A twin from disk or a hired one, as the skills route resolves it. */
export async function findTwin(id: string) {
  const fromDisk = await loadEmployeesFromDisk();
  return [...fromDisk, ...getHiredEmployees().filter((h) => !fromDisk.some((e) => e.id === h.id))].find((e) => e.id === id);
}

export function defaultClaudeDir(): string {
  return path.join(os.homedir(), ".claude");
}

/** The source must be a directory named `.claude` (user or project scope). */
export function resolveSourceDir(input?: string): string {
  const dir = path.resolve(input?.trim() || defaultClaudeDir());
  if (path.basename(dir) !== ".claude") {
    throw new Error("The source folder must be a .claude directory.");
  }
  try {
    if (fs.lstatSync(dir).isSymbolicLink()) throw new Error("The .claude folder must not be a symlink.");
  } catch (err) {
    if (err instanceof Error && err.message.includes("symlink")) throw err;
  }
  return dir;
}

function readText(file: string, maxBytes = MAX_FILE_BYTES): string | null {
  try {
    const st = fs.lstatSync(file);
    if (!st.isFile() || st.size > maxBytes) return null; // symlinks and oversize skipped
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

function listDir(dir: string): fs.Dirent[] {
  try {
    if (!fs.lstatSync(dir).isDirectory()) return []; // a symlinked folder is not followed
    return fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

function frontmatterValue(raw: string, key: string): string {
  const m = raw.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!m) return "";
  const line = m[1].split("\n").find((l) => l.startsWith(`${key}:`));
  return line ? line.slice(key.length + 1).trim().replace(/^['"]|['"]$/g, "") : "";
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}

/** Drop userinfo, query and fragment: they can carry tokens. */
function cleanUrl(raw: string): { url: string; stripped: boolean } | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    const stripped = Boolean(u.username || u.password || u.search || u.hash);
    u.username = "";
    u.password = "";
    u.search = "";
    u.hash = "";
    // A token can also sit in the path (e.g. /s/<secret>/mcp): treat long or
    // mixed letter+digit segments as secrets and refuse the URL.
    // Checked on the raw and the percent-decoded segment, whatever characters
    // it uses (JWTs carry dots, base64 carries + / =), and on host labels.
    const segTokenLike = (raw: string) => {
      let decoded = raw;
      try { decoded = decodeURIComponent(raw); } catch { /* keep raw */ }
      return [raw, decoded].some(
        (s) => s.length >= 24 || /^eyJ/.test(s) || (s.length >= 12 && /[A-Za-z]/.test(s) && /\d/.test(s)),
      );
    };
    const labelTokenLike = (l: string) => l.length >= 20 || (/^[a-z0-9]+$/i.test(l) && l.length >= 6 && /[a-z]/i.test(l) && /\d/.test(l));
    const tokenLike =
      u.pathname.split("/").some(segTokenLike) || u.hostname.split(".").some(labelTokenLike);
    return { url: u.toString(), stripped: stripped || tokenLike };
  } catch {
    return null;
  }
}

/** Only the `mcpServers` key is used; the rest of .claude.json is never copied. */
function readMcpEntries(parent: string, skipped: ImportPreview["skipped"]): Array<[string, unknown]> {
  const file = path.join(parent, ".claude.json");
  if (!fs.existsSync(file)) return [];
  const raw = readText(file, MAX_CLAUDE_JSON_BYTES);
  if (!raw) {
    skipped.push({ what: ".claude.json", reason: "could not be read (too large or not a regular file)" });
    return [];
  }
  try {
    const servers = (JSON.parse(raw) as { mcpServers?: unknown }).mcpServers;
    return servers && typeof servers === "object" && !Array.isArray(servers) ? Object.entries(servers) : [];
  } catch {
    skipped.push({ what: ".claude.json", reason: "not valid JSON" });
    return [];
  }
}

export async function previewClaudeCodeImport(
  employeeId: string,
  sourceDir?: string,
): Promise<ImportPreview> {
  const root = resolveSourceDir(sourceDir);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new Error("That .claude folder was not found.");
  }
  const items: ImportItem[] = [];
  const skipped: ImportPreview["skipped"] = [];

  // Skills → org skills
  const seenSkills = new Set<string>();
  for (const entry of listDir(path.join(root, "skills"))) {
    if (!entry.isDirectory()) continue;
    if (items.filter((i) => i.kind === "skill").length >= MAX_ITEMS_PER_KIND) {
      skipped.push({ what: `skills/${entry.name}`, reason: "over the item limit" });
      continue;
    }
    const content = readText(path.join(root, "skills", entry.name, "SKILL.md"));
    if (content === null) {
      skipped.push({ what: `skills/${entry.name}`, reason: "no readable SKILL.md" });
      continue;
    }
    const id = slug(frontmatterValue(content, "name")) || slug(entry.name);
    if (!id || seenSkills.has(id)) {
      skipped.push({ what: `skills/${entry.name}`, reason: id ? "same name as another skill" : "no usable name" });
      continue;
    }
    seenSkills.add(id);
    items.push({
      kind: "skill",
      id,
      label: frontmatterValue(content, "name") || entry.name,
      status: readOrgSkill(id) ? "exists" : "new",
      content,
    });
  }

  // http/sse MCP servers → custom MCP (url only)
  const seenMcp = new Set<string>();
  const existing = new Set((await listCustomMcp()).map((s) => previewKey(s.name)));
  for (const [name, cfg] of readMcpEntries(path.dirname(root), skipped)) {
    const c = (cfg ?? {}) as { type?: unknown; url?: unknown };
    if (c.type !== "http" && c.type !== "sse") {
      skipped.push({ what: `mcp ${name}`, reason: "only http and sse servers are imported" });
      continue;
    }
    const cleaned = typeof c.url === "string" ? cleanUrl(c.url) : null;
    if (!cleaned || !previewKey(name)) {
      skipped.push({ what: `mcp ${name}`, reason: "no valid url" });
      continue;
    }
    if (cleaned.stripped) {
      // The token would be lost and the server would not work; don't import a broken copy.
      skipped.push({ what: `mcp ${name}`, reason: "url carries credentials (userinfo, query or a token-like path); add it by hand" });
      continue;
    }
    if (seenMcp.has(previewKey(name))) {
      skipped.push({ what: `mcp ${name}`, reason: "same name as another server" });
      continue;
    }
    seenMcp.add(previewKey(name));
    items.push({
      kind: "mcp",
      name,
      transport: c.type,
      url: cleaned.url,
      status: existing.has(previewKey(name)) ? "exists" : "new",
    });
  }

  // CLAUDE.md and rules → the person's own knowledge
  const knowledgeNow = new Set<string>();
  const addKnowledge = (source: string, name: string, content: string) => {
    if (knowledgeNow.has(name)) {
      skipped.push({ what: source, reason: "same imported file name as another rule" });
      return;
    }
    knowledgeNow.add(name);
    items.push({
      kind: "knowledge",
      source,
      name,
      status: "update", // resolved below
      bytes: Buffer.byteLength(content),
      content,
    });
  };
  const claudeMd = readText(path.join(root, "CLAUDE.md"));
  if (claudeMd !== null) addKnowledge("CLAUDE.md", "claude-code-CLAUDE.md", claudeMd);
  else if (fs.existsSync(path.join(root, "CLAUDE.md"))) skipped.push({ what: "CLAUDE.md", reason: "too large or not a regular file" });
  const walkRules = (dir: string, rel: string, depth: number) => {
    for (const entry of listDir(dir)) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) {
        skipped.push({ what: `rules/${childRel}`, reason: "symlinks are not followed" });
        continue;
      }
      if (entry.isDirectory() && depth >= MAX_RULE_DEPTH) skipped.push({ what: `rules/${childRel}`, reason: "nested too deep" });
      else if (entry.isDirectory()) walkRules(path.join(dir, entry.name), childRel, depth + 1);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
        const content = readText(path.join(dir, entry.name));
        if (content === null) {
          skipped.push({ what: `rules/${childRel}`, reason: "too large or not a regular file" });
          continue;
        }
        const base = childRel.replace(/\.md$/i, "");
        const key = slug(base) || createHash("sha256").update(base).digest("hex").slice(0, 8);
        addKnowledge(`rules/${childRel}`, `claude-code-rule-${key}.md`, content);
      }
    }
  };
  walkRules(path.join(root, "rules"), "", 0);

  // Knowledge files for this employee: a re-import updates (versioned), new otherwise.
  const have = new Set(listKnowledgeFiles(employeeId).map((f) => f.name));
  for (const i of items) if (i.kind === "knowledge") i.status = have.has(i.name) ? "update" : "new";

  const counts = {
    skills: items.filter((i) => i.kind === "skill").length,
    mcpServers: items.filter((i) => i.kind === "mcp").length,
    knowledge: items.filter((i) => i.kind === "knowledge").length,
  };
  const digest = createHash("sha256")
    .update(JSON.stringify({ employeeId, root, items }))
    .digest("hex");
  return {
    sourcePath: root,
    notice:
      "This reads the Claude Code folder of the user running Employee001 on this machine, and adds it to this twin. Skills are assigned to this twin; MCP servers are added to the whole organisation, disabled, with any headers, env and authentication left out.",
    items,
    counts,
    skipped,
    digest,
  };
}

export async function applyClaudeCodeImport(opts: {
  employeeId: string;
  employeeName: string;
  sourceDir?: string;
  previewDigest: string;
  actorId: string;
}): Promise<ImportResult> {
  const preview = await previewClaudeCodeImport(opts.employeeId, opts.sourceDir);
  if (preview.digest !== opts.previewDigest) {
    throw new ImportChangedError();
  }
  const imported = { skills: 0, mcpServers: 0, knowledge: 0 };
  let skippedExisting = 0;
  let failure: unknown = null;
  const assignable: string[] = [];
  try {
    for (const item of preview.items) {
    if (item.kind === "skill") {
      assignable.push(item.id);
      if (item.status === "exists") { skippedExisting++; continue; }
      // Pin the id so the folder written matches the id the preview showed.
      const fm = item.content.replace(/\r\n/g, "\n").match(/^---\s*\n([\s\S]*?)\n---\s*(?:\n([\s\S]*))?$/);
      const content = fm
        ? `---\nid: ${item.id}\n${fm[1].split("\n").filter((l) => !l.startsWith("id:")).join("\n")}\n---\n${fm[2] ?? ""}`
        : `---\nid: ${item.id}\n---\n${item.content}`;
      importOrgSkillMarkdown({ filename: `${item.id}.md`, content });
      imported.skills++;
    } else if (item.kind === "mcp") {
      if (item.status === "exists") { skippedExisting++; continue; }
      // Disabled: an admin turns it on, so a twin gains no tool by import alone.
      await createCustomMcp({ name: item.name, transport: item.transport, url: item.url, headers: [], enabled: false });
      imported.mcpServers++;
    } else {
      if (writeKnowledgeFile(opts.employeeId, item.name, item.content)) imported.knowledge++;
    }
    }
    // The twin only uses org skills assigned to it, so assign what was previewed.
    if (assignable.length > 0) {
      // Same fallback as the skills route, so a twin's default role skills survive.
      const employee = await findTwin(opts.employeeId);
      const current = getAssignedOrgSkillIdsForEmployee(opts.employeeId, employee?.orgSkillIds ?? []);
      setAssignedOrgSkillIds(opts.employeeId, [...current, ...assignable]);
    }
  } catch (err) {
    failure = err;
  }
  const auditRecorded = appendAuditEntry({
    runId: "import-claude-code",
    employeeId: opts.employeeId,
    employeeName: opts.employeeName,
    toolName: "import_claude_code",
    bareName: "import_claude_code",
    input: { sourcePath: preview.sourcePath, counts: imported, skippedExisting, ...(failure ? { failed: true } : {}) },
    verdict: "ceo_approved",
    approvedBy: opts.actorId,
    approvalChannel: "ui",
    requesterId: opts.actorId,
  });
  if (failure) throw failure; // what was written before the failure is audited above
  return { imported, skippedExisting, auditRecorded };
}

export class ImportChangedError extends Error {
  constructor() {
    super("The Claude Code files changed since the preview. Preview again.");
  }
}

/** What the route may show: the preview without file bodies. */
export function previewForClient(p: ImportPreview) {
  return {
    ...p,
    items: p.items.map((i) => {
      if (i.kind === "mcp") return i;
      const { content: _content, ...rest } = i;
      void _content;
      return rest;
    }),
  };
}
