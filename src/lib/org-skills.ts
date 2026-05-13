import fs from "fs";
import path from "path";
import type { EmployeeWithTwin } from "@/lib/employees";

const ORG_SKILLS_DIR = path.join(process.cwd(), "data", "org-skills");
const ASSIGNMENTS_FILE = path.join(
  process.cwd(),
  "data",
  "org",
  "skill-assignments.json"
);
const DEFAULT_LIMIT = 3;

export type OrgSkillPlaybook = {
  id: string;
  label: string;
  description: string;
  triggers: string[];
  body: string;
};

export type OrgSkillHit = {
  skill: OrgSkillPlaybook;
  score: number;
};

export type OrgSkillInput = {
  id: string;
  label: string;
  description: string;
  triggers: string[];
  body: string;
};

export type OrgSkillImportFile = {
  filename: string;
  content: string;
};

const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;

function parseFrontmatter(raw: string): {
  fm: Record<string, string | string[]>;
  body: string;
} {
  const match = raw.match(FRONTMATTER_RE);
  if (!match) return { fm: {}, body: raw };

  const fm: Record<string, string | string[]> = {};
  for (const line of match[1].split("\n")) {
    const kv = line.match(/^([a-zA-Z_]+):\s*(.+)$/);
    if (!kv) continue;
    const key = kv[1];
    const value = kv[2].trim();

    if (value.startsWith("[") && value.endsWith("]")) {
      const inner = value.slice(1, -1).trim();
      fm[key] = inner
        ? inner.split(",").map((item) => item.trim().replace(/^['"]|['"]$/g, ""))
        : [];
      continue;
    }

    fm[key] = value.replace(/^['"]|['"]$/g, "");
  }

  return { fm, body: match[2]?.trim() ?? "" };
}

export function readOrgSkill(skillId: string): OrgSkillPlaybook | null {
  const filePath = path.join(ORG_SKILLS_DIR, safeSegment(skillId), "SKILL.md");
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const { fm, body } = parseFrontmatter(raw);
    return {
      id: stringValue(fm.id) || skillId,
      label: stringValue(fm.label) || skillId,
      description: stringValue(fm.description),
      triggers: arrayValue(fm.triggers),
      body,
    };
  } catch {
    return null;
  }
}

export function listOrgSkills(): OrgSkillPlaybook[] {
  try {
    return fs
      .readdirSync(ORG_SKILLS_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => readOrgSkill(entry.name))
      .filter((skill): skill is OrgSkillPlaybook => Boolean(skill))
      .sort((a, b) => a.label.localeCompare(b.label));
  } catch {
    return [];
  }
}

export function writeOrgSkill(input: OrgSkillInput): OrgSkillPlaybook {
  const id = safeSegment(input.id.trim().toLowerCase());
  if (!id) throw new Error("skill id is required");

  const skill: OrgSkillPlaybook = {
    id,
    label: input.label.trim() || id,
    description: input.description.trim(),
    triggers: input.triggers.map((t) => t.trim()).filter(Boolean),
    body: input.body.trim(),
  };

  const dir = path.join(ORG_SKILLS_DIR, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"), serializeSkill(skill), "utf8");
  return skill;
}

export function importOrgSkillMarkdown(file: OrgSkillImportFile): OrgSkillPlaybook {
  const { fm, body } = parseFrontmatter(file.content);
  const heading = firstHeading(body);
  const label =
    stringValue(fm.label) ||
    titleFromName(stringValue(fm.name)) ||
    heading ||
    titleFromName(file.filename.replace(/\.md$/i, ""));
  const id =
    stringValue(fm.id) ||
    stringValue(fm.name) ||
    label ||
    file.filename.replace(/\.md$/i, "");
  const description = stringValue(fm.description);
  const triggers =
    arrayValue(fm.triggers).length > 0
      ? arrayValue(fm.triggers)
      : inferTriggers(id, label, description);

  return writeOrgSkill({
    id,
    label,
    description,
    triggers,
    body: body.trim() || file.content.trim(),
  });
}

function firstHeading(body: string): string {
  const match = body.match(/^#\s+(.+)$/m);
  return match?.[1]?.trim() ?? "";
}

function titleFromName(name: string): string {
  return name
    .replace(/\.md$/i, "")
    .replace(/^skill$/i, "")
    .replace(/[-_]+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function inferTriggers(...parts: string[]): string[] {
  return Array.from(
    new Set(
      parts
        .join(" ")
        .toLowerCase()
        .match(/[\p{L}\p{N}_-]{3,}/gu) ?? []
    )
  )
    .filter((token) => !STOPWORDS.has(token))
    .slice(0, 8);
}

function serializeSkill(skill: OrgSkillPlaybook): string {
  return `---
id: ${skill.id}
label: ${skill.label}
description: ${skill.description}
triggers: [${skill.triggers.join(", ")}]
---

${skill.body.replace(/\s+$/, "")}
`;
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function stringValue(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

function arrayValue(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value) return [value];
  return [];
}

function tokenize(text: string): Set<string> {
  const tokens = text.toLowerCase().match(/[\p{L}\p{N}_-]{2,}/gu) ?? [];
  return new Set(tokens.filter((token) => !STOPWORDS.has(token)));
}

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "that",
  "this",
  "with",
  "you",
  "are",
  "was",
  "were",
  "what",
  "how",
  "של",
  "על",
  "עם",
  "את",
  "זה",
  "מה",
  "איך",
]);

function scoreSkill(skill: OrgSkillPlaybook, question: string): number {
  const queryTokens = tokenize(question);
  if (queryTokens.size === 0) return 0;

  let score = 0;
  const haystack = tokenize(
    [skill.id, skill.label, skill.description, skill.triggers.join(" ")]
      .join(" ")
      .toLowerCase()
  );

  for (const token of queryTokens) {
    if (haystack.has(token)) score += 1;
  }

  for (const trigger of skill.triggers) {
    if (question.toLowerCase().includes(trigger.toLowerCase())) {
      score += 2;
    }
  }

  return score;
}

export function selectOrgSkillsForRun(
  employee: EmployeeWithTwin,
  question: string,
  limit = DEFAULT_LIMIT
): OrgSkillHit[] {
  const assigned = getAssignedOrgSkillIds(employee)
    .map(readOrgSkill)
    .filter((skill): skill is OrgSkillPlaybook => Boolean(skill));

  if (assigned.length === 0) return [];

  const scored = assigned
    .map((skill) => ({ skill, score: scoreSkill(skill, question) }))
    .sort((a, b) => b.score - a.score);

  const relevant = scored.filter((hit) => hit.score > 0);
  return (relevant.length > 0 ? relevant : scored).slice(0, limit);
}

export function getAssignedOrgSkillIds(employee: EmployeeWithTwin): string[] {
  const assignments = readAssignments();
  return assignments[employee.id] ?? employee.orgSkillIds;
}

export function getAssignedOrgSkillIdsForEmployee(
  employeeId: string,
  fallback: string[] = []
): string[] {
  const assignments = readAssignments();
  return assignments[employeeId] ?? fallback;
}

export function setAssignedOrgSkillIds(
  employeeId: string,
  skillIds: string[]
): string[] {
  const allowed = new Set(listOrgSkills().map((skill) => skill.id));
  const next = Array.from(
    new Set(skillIds.map((id) => safeSegment(id)).filter((id) => allowed.has(id)))
  );
  const assignments = readAssignments();
  assignments[employeeId] = next;
  writeAssignments(assignments);
  return next;
}

function readAssignments(): Record<string, string[]> {
  try {
    return JSON.parse(fs.readFileSync(ASSIGNMENTS_FILE, "utf8")) as Record<
      string,
      string[]
    >;
  } catch {
    return {};
  }
}

function writeAssignments(assignments: Record<string, string[]>): void {
  fs.mkdirSync(path.dirname(ASSIGNMENTS_FILE), { recursive: true });
  fs.writeFileSync(ASSIGNMENTS_FILE, JSON.stringify(assignments, null, 2), "utf8");
}

export function formatOrgSkillsBlock(hits: OrgSkillHit[]): string {
  if (hits.length === 0) return "";

  const skills = hits
    .map(
      ({ skill }) => `## ${skill.label} (${skill.id})

${skill.body}`
    )
    .join("\n\n---\n\n");

  return `# Relevant organization skills

These are organization-level playbooks assigned to this employee. Use them to
shape how work is performed. They do not override hard boundaries, approval
policy, or the employee's profile files.

${skills}`;
}
