// The handover package of one twin, on disk at data/handovers/<id>/:
//   interview.json  the live interview transcript (saved every turn, so the
//                   employee can pause and come back)
//   package.json    the Role Context Package synthesized from it. Edits clear
//                   the review; only a reviewed package is used to answer.
//
// packageMarkdown() renders the package for people (the CEO's download) and
// for the retired twin's prompt.

import "server-only";
import fs from "fs/promises";
import path from "path";
import { dataDir } from "../app-home";
import type { CapturedItem, RoleContextPackage, ToolingRef } from "./rcp.types";

export type InterviewMessage = { role: "user" | "assistant"; content: string };

export const PACKAGE_FIELDS = [
  "decision_rules",
  "playbooks",
  "contact_graph",
  "edge_cases",
  "tooling_map",
  "glossary",
  "open_loops",
] as const;
export type PackageField = (typeof PACKAGE_FIELDS)[number];

export const FIELD_LABELS: Record<PackageField, string> = {
  decision_rules: "Decision rules",
  playbooks: "How things are done",
  contact_graph: "Who to go to",
  edge_cases: "Watch out for",
  tooling_map: "Systems and access",
  glossary: "Glossary",
  open_loops: "Open at handover",
};

const dir = (id: string) => dataDir("handovers", id);
const interviewPath = (id: string) => path.join(/*turbopackIgnore: true*/ dir(id), "interview.json");
const packagePath = (id: string) => path.join(/*turbopackIgnore: true*/ dir(id), "package.json");

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(/*turbopackIgnore: true*/ file, "utf8")) as T;
  } catch {
    return null;
  }
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(/*turbopackIgnore: true*/ tmp, JSON.stringify(value, null, 2), "utf8");
  await fs.rename(tmp, file);
}

export async function loadInterview(id: string): Promise<InterviewMessage[]> {
  const raw = await readJson<{ messages?: InterviewMessage[] }>(interviewPath(id));
  return Array.isArray(raw?.messages) ? raw.messages : [];
}

export async function saveInterview(id: string, messages: InterviewMessage[]): Promise<void> {
  const clean = messages
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .map((m) => ({ role: m.role, content: m.content.slice(0, 20_000) }))
    .slice(-400);
  await writeJson(interviewPath(id), { updatedAt: new Date().toISOString(), messages: clean });
}

export async function loadPackage(id: string): Promise<RoleContextPackage | null> {
  return readJson<RoleContextPackage>(packagePath(id));
}

export async function savePackage(id: string, rcp: RoleContextPackage): Promise<void> {
  await writeJson(packagePath(id), rcp);
}

/** Remove the whole handover folder (used when a handover is cancelled). */
export async function deleteHandover(id: string): Promise<void> {
  await fs.rm(dir(id), { recursive: true, force: true });
}

export type ItemEdit =
  | { op: "remove"; field: PackageField; itemId: string }
  | { op: "update"; field: PackageField; itemId: string; title?: string; body?: string };

/** Apply one reviewer edit. Any edit clears an earlier approval. */
export function applyItemEdit(rcp: RoleContextPackage, edit: ItemEdit): RoleContextPackage | null {
  const items = rcp[edit.field] as Array<CapturedItem | ToolingRef>;
  const index = items.findIndex((it) => it.id === edit.itemId);
  if (index < 0) return null;
  const next = [...items];
  if (edit.op === "remove") {
    next.splice(index, 1);
  } else {
    const item = next[index];
    if ("system" in item) {
      next[index] = {
        ...item,
        ...(edit.title !== undefined ? { system: edit.title.slice(0, 300) } : {}),
        ...(edit.body !== undefined ? { location: edit.body.slice(0, 4000) } : {}),
      };
    } else {
      next[index] = {
        ...item,
        ...(edit.title !== undefined ? { title: edit.title.slice(0, 300) } : {}),
        ...(edit.body !== undefined ? { body: edit.body.slice(0, 4000) } : {}),
      };
    }
  }
  const { review: _review, ...rest } = rcp;
  void _review;
  const itemCount = PACKAGE_FIELDS.reduce((n, f) => n + (f === edit.field ? next.length : rcp[f].length), 0);
  return { ...rest, [edit.field]: next, provenance: { ...rcp.provenance, itemCount } } as RoleContextPackage;
}

export function approvePackage(rcp: RoleContextPackage, approvedBy?: string): RoleContextPackage {
  return { ...rcp, review: { approvedAt: new Date().toISOString(), ...(approvedBy ? { approvedBy } : {}) } };
}

function itemLines(item: CapturedItem | ToolingRef): string[] {
  if ("system" in item) {
    const parts = [item.location, item.accessVia && `access: ${item.accessVia}`, item.ownedBy && `owner: ${item.ownedBy}`].filter(Boolean);
    return [`- **${item.system}**${parts.length ? `: ${parts.join("; ")}` : ""}`];
  }
  const body = item.body.trim();
  const lines = [`- **${item.title}**${body && !body.includes("\n") ? `: ${body}` : ""}`];
  if (body.includes("\n")) lines.push(...body.split("\n").map((l) => `  ${l}`));
  return lines;
}

/**
 * The package as Markdown. `withSources` adds each item's verbatim quote from
 * the interview and marks the ones that couldn't be checked against it.
 */
export function packageMarkdown(
  rcp: RoleContextPackage,
  opts: { name: string; role?: string; withSources?: boolean },
): string {
  const out: string[] = [`# Handover: ${opts.name}${opts.role ? `, ${opts.role}` : ""}`, ""];
  const reviewed = rcp.review ? `reviewed ${rcp.review.approvedAt.slice(0, 10)}` : "not reviewed yet";
  out.push(`Captured in a handover interview on ${rcp.generated_at.slice(0, 10)} (${reviewed}).`, "");
  for (const field of PACKAGE_FIELDS) {
    const items = rcp[field] as Array<CapturedItem | ToolingRef>;
    if (!items.length) continue;
    out.push(`## ${FIELD_LABELS[field]}`, "");
    for (const item of items) {
      out.push(...itemLines(item));
      if (opts.withSources) {
        if (item.evidenceQuote) out.push(`  > ${item.evidenceQuote.replace(/\s+/g, " ").trim()}`);
        if (item.verified === false) out.push("  _Not confirmed word for word in the interview._");
      }
    }
    out.push("");
  }
  return out.join("\n").trim() + "\n";
}
