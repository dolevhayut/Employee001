// Cross-twin contradiction scan: finds places where two twins hold different
// answers to the same question (for example who approves releases) and files
// one Inbox item per conflict, so the CEO hears about it before a customer or a
// decision does.
//
// It compares two kinds of claim, both read-only:
//   - durable facts in each twin's structured memory, and
//   - claims in the profile files a peer twin is already allowed to read
//     (twin-read-scope PEER_PROFILE_FILES), limited to the org-facing ones.
// Detection is deliberately conservative (false negatives are fine, false
// alarms are not): a claim is a "<subject> is <value>", "<label>: <value>" or
// "<Person> approves/owns/leads <thing>" statement, and two twins conflict
// only when their normalized subjects match and neither value contains the other.

import { createHash } from "crypto";
import { appendAuditEntry } from "@/lib/audit-log";
import { ROLE_RANK } from "@/lib/auth/rbac";
import type { Role } from "@/lib/auth/request-user";
import { loadEmployeesFromDisk } from "@/lib/employees-disk";
import { readEmployeeFile } from "@/lib/employees-files";
import { appendFeedItem, listFeed, type ContradictionSide } from "@/lib/feed-store";
import { redactSensitive } from "@/lib/sensitive-content";
import { PEER_PROFILE_FILES } from "@/lib/twin-read-scope";
import { listCurrentStructuredFacts } from "@/lib/twin-memory";

/** Profile files compared. Personal files (tone, preferences, boundaries,
 *  employment) are never scanned or quoted into the Inbox. */
const SCANNED_PROFILE_FILES = ["CONTEXT.md", "DECISIONS.md", "PROJECTS.md", "PEOPLE.md", "EXPERTISE.md"].filter((f) =>
  PEER_PROFILE_FILES.has(f)
);
/** Structured-memory types that state something about the organisation. */
const SCANNED_FACT_TYPES = new Set(["fact", "decision"]);

export type Claim = {
  employeeId: string;
  employeeName: string;
  /** Normalized subject: the matching key. */
  subjectKey: string;
  /** Subject as written, for display. */
  subject: string;
  value: string;
  source: string;
};

export type Conflict = {
  fingerprint: string;
  subject: string;
  a: ContradictionSide;
  b: ContradictionSide;
};

export type Viewer = { id: string; role: Role } | null;

export type ScanResult = {
  twinsScanned: number;
  claimsCompared: number;
  conflicts: Conflict[];
  /** Conflicts that got a new Inbox item in this run. */
  created: number;
  /** Conflicts that already had an Inbox item (open or closed). */
  alreadyFiled: number;
};

/** The scan reads every colleague's twin, so it needs the member role. With no
 *  accounts (no viewer) the local owner may run it. */
export function canRunContradictionScan(viewer: Viewer): boolean {
  return !viewer || ROLE_RANK[viewer.role] >= ROLE_RANK.member;
}

// ─── Claim extraction ─────────────────────────────────────────────────────────

const STOPWORDS = new Set(["the", "a", "an", "our", "of", "for", "who", "current", "currently", "main", "team"]);
const FIRST_PERSON = new Set(["i", "me", "my", "mine", "we", "us", "im", "ive"]);
const PRONOUN_START = /^(?:it|this|that|there|he|she|they|you|what|which|how|why|when|where)\b/i;
const NEGATION = /\b(?:not|never|no|none|cannot|can't|don't|doesn't|didn't|won't|isn't|aren't|wasn't|weren't|used to|formerly|previously)\b/i;
const ACTOR_VERBS: Record<string, string> = {
  approves: "approves",
  approve: "approves",
  owns: "owns",
  leads: "leads",
  manages: "manages",
  runs: "runs",
  "signs off on": "approves",
  "signs off": "approves",
};

function normalizeWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** One-word labels that describe a document or a person, not an org-wide
 *  question ("Status: active", "Owner: Dana" differ per project). */
const GENERIC_SUBJECTS = new Set([
  "status", "owner", "role", "name", "title", "team", "department", "goal", "goals", "notes", "summary", "focus",
  "location", "email", "phone", "date", "priority", "stage", "type", "version", "description", "context", "purpose",
  "manager", "lead", "contact", "deadline", "timezone", "language", "company", "project", "stack", "tools",
]);

function subjectKeyOf(subject: string): string | null {
  const tokens = normalizeWords(subject);
  if (tokens.some((t) => FIRST_PERSON.has(t))) return null;
  const kept = tokens.filter((t) => !STOPWORDS.has(t));
  if (kept.length === 0 || kept.length > 5) return null;
  if (kept.length === 1 && GENERIC_SUBJECTS.has(kept[0])) return null;
  return [...kept].sort().join(" ");
}

function normalizeValue(value: string): string {
  return normalizeWords(value).join(" ");
}

function cleanLine(line: string): string {
  return line
    .replace(/^[\s>*\-•+]+/, "")
    .replace(/^\d+[.)]\s+/, "")
    .replace(/\*\*|__|`/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Pull one { subject, value } claim out of a single line, or null. */
export function extractClaim(rawLine: string): { subject: string; value: string } | null {
  const line = cleanLine(rawLine).replace(/[.]+$/, "");
  if (line.length < 8 || line.length > 220) return null;
  if (line.startsWith("#") || line.includes("?") || NEGATION.test(line)) return null;

  const actor = /^([A-Z][\p{L}'-]+(?:\s+[A-Z][\p{L}'-]+)?)\s+(approves|owns|leads|manages|runs|signs off on|signs off)\s+(.{3,80})$/u.exec(line);
  if (actor) {
    const verb = ACTOR_VERBS[actor[2]];
    return { subject: `${verb} ${actor[3]}`, value: actor[1] };
  }
  const copula = /^(.{3,60}?)\s+(?:is|are|will be)\s+(.{2,120})$/i.exec(line);
  if (copula && !PRONOUN_START.test(copula[1])) return { subject: copula[1], value: copula[2] };
  const label = /^([^:]{3,50}):\s*(.{2,120})$/.exec(line);
  if (label && !PRONOUN_START.test(label[1])) return { subject: label[1], value: label[2] };
  return null;
}

function toClaim(
  employee: { id: string; name: string },
  text: string,
  source: string
): Claim | null {
  const parsed = extractClaim(text);
  if (!parsed) return null;
  const subjectKey = subjectKeyOf(parsed.subject);
  if (!subjectKey || !normalizeValue(parsed.value)) return null;
  return {
    employeeId: employee.id,
    employeeName: employee.name,
    subjectKey,
    subject: parsed.subject.trim(),
    value: parsed.value.trim(),
    source,
  };
}

/** Two values conflict when they differ and neither contains the other. */
export function valuesConflict(a: string, b: string): boolean {
  const na = normalizeValue(a);
  const nb = normalizeValue(b);
  if (!na || !nb || na === nb) return false;
  const pad = (s: string) => ` ${s} `;
  return !pad(na).includes(pad(nb)) && !pad(nb).includes(pad(na));
}

/** Pure comparison step: one conflict per twin pair and subject. */
export function findConflicts(claims: Claim[]): Conflict[] {
  const bySubject = new Map<string, Claim[]>();
  for (const claim of claims) {
    const list = bySubject.get(claim.subjectKey) ?? [];
    list.push(claim);
    bySubject.set(claim.subjectKey, list);
  }
  const out: Conflict[] = [];
  for (const [subjectKey, list] of bySubject) {
    const twinIds = [...new Set(list.map((c) => c.employeeId))].sort();
    for (let i = 0; i < twinIds.length; i++) {
      for (let j = i + 1; j < twinIds.length; j++) {
        const left = list.filter((c) => c.employeeId === twinIds[i]);
        const right = list.filter((c) => c.employeeId === twinIds[j]);
        const pair = pickPair(left, right);
        if (!pair) continue;
        const [a, b] = pair;
        // Twin pair + subject only: editing or reordering a line must not turn
        // the same dispute into a new Inbox item.
        const fingerprint = createHash("sha256")
          .update([twinIds[i], twinIds[j], subjectKey].join("|"))
          .digest("hex")
          .slice(0, 16);
        out.push({
          fingerprint,
          subject: a.subject,
          a: { employeeId: a.employeeId, employeeName: a.employeeName, value: a.value, source: a.source },
          b: { employeeId: b.employeeId, employeeName: b.employeeName, value: b.value, source: b.source },
        });
      }
    }
  }
  return out;
}

function pickPair(left: Claim[], right: Claim[]): [Claim, Claim] | null {
  for (const a of left) for (const b of right) if (valuesConflict(a.value, b.value)) return [a, b];
  return null;
}

// ─── Scan ─────────────────────────────────────────────────────────────────────

async function collectClaims(): Promise<{ claims: Claim[]; twinsScanned: number }> {
  const employees = (await loadEmployeesFromDisk()).filter((e) => e.lifecycle !== "retired");
  const claims: Claim[] = [];
  for (const employee of employees) {
    const who = { id: employee.id, name: employee.name };
    for (const fact of listCurrentStructuredFacts(employee.id)) {
      if (!SCANNED_FACT_TYPES.has(fact.type)) continue;
      // The pattern extractor stores only the part after the verb; the evidence
      // holds the whole sentence. LLM-extracted facts carry it in `value`.
      const claim =
        toClaim(who, fact.evidence ?? "", `memory: durable fact ${fact.id}`) ??
        toClaim(who, fact.value, `memory: durable fact ${fact.id}`);
      if (claim) claims.push(claim);
    }
    for (const file of SCANNED_PROFILE_FILES) {
      const lines = readEmployeeFile(employee.id, file).split("\n");
      lines.forEach((line, index) => {
        const claim = toClaim(who, line, `profile: ${file} line ${index + 1}`);
        if (claim) claims.push(claim);
      });
    }
  }
  return { claims, twinsScanned: employees.length };
}

const show = (text: string) => redactSensitive(text).slice(0, 140);

let running: Promise<ScanResult> | null = null;

/** Run the scan and file one Inbox item per conflict not already filed.
 *  Concurrent calls share one run, so a double click cannot file twice. */
export function scanContradictions(viewer: Viewer): Promise<ScanResult> {
  if (!canRunContradictionScan(viewer)) return Promise.reject(new Error("forbidden"));
  running ??= runScan(viewer).finally(() => {
    running = null;
  });
  return running;
}

async function runScan(viewer: Viewer): Promise<ScanResult> {
  const { claims, twinsScanned } = await collectClaims();
  const conflicts = findConflicts(claims);
  const filed = new Set(
    listFeed({ type: "alert" }).flatMap((item) => (item.source.kind === "contradiction" ? [item.source.fingerprint] : []))
  );
  let created = 0;
  for (const conflict of conflicts) {
    if (filed.has(conflict.fingerprint)) continue;
    filed.add(conflict.fingerprint);
    // Durable memory comes from private conversations and the Inbox is
    // member-readable, so a memory-sourced side is cited but not quoted.
    const side = (s: ContradictionSide): ContradictionSide =>
      s.source.startsWith("memory:") ? { ...s, value: "" } : { ...s, value: show(s.value) };
    const a = side(conflict.a);
    const b = side(conflict.b);
    const said = (s: ContradictionSide) => (s.value ? `"${s.value}"` : "something different (kept private)");
    appendFeedItem({
      source: {
        kind: "contradiction",
        fingerprint: conflict.fingerprint,
        subject: show(conflict.subject),
        a,
        b,
      },
      type: "alert",
      title: `${a.employeeName} and ${b.employeeName} disagree: ${show(conflict.subject)}`,
      detail: `${a.employeeName}: ${said(a)} (${a.source}). ${b.employeeName}: ${said(b)} (${b.source}).`,
      priority: 2,
    });
    created++;
  }
  const result: ScanResult = {
    twinsScanned,
    claimsCompared: claims.length,
    conflicts,
    created,
    alreadyFiled: conflicts.length - created,
  };
  appendAuditEntry({
    runId: `contradiction-scan-${Date.now()}`,
    employeeId: "system",
    employeeName: "Contradiction scan",
    toolName: "contradictionScan",
    bareName: "contradictionScan",
    input: {
      twinsScanned,
      claimsCompared: result.claimsCompared,
      conflicts: conflicts.length,
      created,
      alreadyFiled: result.alreadyFiled,
      profileFiles: SCANNED_PROFILE_FILES,
    },
    verdict: "executed",
    approvalChannel: "ui",
    ...(viewer ? { requesterId: viewer.id } : {}),
  });
  return result;
}
