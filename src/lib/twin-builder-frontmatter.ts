// The frontmatter on each twin profile file states when the file was built
// and what it was built from. The builder model writes it, but the platform
// knows both facts better than the model does: the build's own clock, and
// which uploaded documents (knowledge/) the builder actually read. These
// helpers make the written frontmatter match those facts.

import fs from "fs";
import path from "path";

const KNOWLEDGE_DIR = "knowledge";
const KNOWLEDGE_PREFIX = `${KNOWLEDGE_DIR}/`;
/** Text the platform extracts from an uploaded PDF/DOCX sits beside it as
 *  `<name>.pdf.md`; reading that is reading the upload. */
const EXTRACTED_COMPANION_RE = /\.(pdf|docx)\.md$/i;

function realPath(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

/**
 * The `knowledge/<name>` source for a Read of `filePath`, or null when the
 * path isn't a file directly inside the twin's knowledge folder. Relative
 * paths resolve against the builder's cwd (`employeeDir`); symlinked
 * spellings of the data folder count as the same place.
 */
export function knowledgeSourceForRead(filePath: unknown, employeeDir: string): string | null {
  if (typeof filePath !== "string" || !filePath.trim()) return null;
  const abs = path.resolve(employeeDir, filePath);
  const name = path.basename(abs);
  if (!name || name.startsWith(".")) return null;
  if (realPath(path.dirname(abs)) !== realPath(path.join(employeeDir, KNOWLEDGE_DIR))) return null;
  const upload = EXTRACTED_COMPANION_RE.test(name) ? name.slice(0, -".md".length) : name;
  return `${KNOWLEDGE_PREFIX}${upload}`;
}

const FRONTMATTER_RE = /^(﻿?)---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

function unquote(s: string): string {
  return s.trim().replace(/^[`'"]|[`'"]$/g, "").trim();
}

function parseInlineList(value: string): string[] {
  const v = value.trim();
  const inner = v.startsWith("[") && v.endsWith("]") ? v.slice(1, -1) : v;
  return inner.split(",").map(unquote).filter(Boolean);
}

function formatItem(s: string): string {
  return /[,[\]{}#:"'`]|^\s|\s$/.test(s) ? JSON.stringify(s) : s;
}

function formatList(items: string[]): string {
  return `[${items.map(formatItem).join(", ")}]`;
}

/** Model-written sources, with its knowledge/ claims replaced by the reads
 *  the platform saw (a claimed document it never read is dropped). */
function mergeSources(claimed: string[], knowledgeSources: string[]): string[] {
  const out: string[] = [];
  for (const s of [...claimed.filter((c) => !c.startsWith(KNOWLEDGE_PREFIX)), ...knowledgeSources]) {
    if (!out.includes(s)) out.push(s);
  }
  return out;
}

export type ProfileStamp = {
  employeeId: string;
  filename: string;
  /** ISO time of the build that wrote the file. */
  generatedAt: string;
  /** `knowledge/<name>` for each uploaded document read before this write. */
  knowledgeSources: string[];
};

/**
 * Sets `generatedAt` and the knowledge/ part of `sources` in a profile
 * file's YAML frontmatter, keeping everything else the model wrote. Adds
 * the frontmatter when the model left it out. `sources` is always written
 * as an inline list, the form the profile readers parse.
 */
export function stampProfileFrontmatter(content: string, stamp: ProfileStamp): string {
  const m = content.match(FRONTMATTER_RE);
  if (!m) {
    const block = [
      "---",
      `employee: ${stamp.employeeId}`,
      `file: ${stamp.filename}`,
      `generatedAt: ${stamp.generatedAt}`,
      `sources: ${formatList(mergeSources([], stamp.knowledgeSources))}`,
      "---",
      "",
    ].join("\n");
    return `${block}${content.replace(/^﻿/, "")}`;
  }

  const [whole, bom, inner] = m;
  const eol = whole.includes("\r\n") ? "\r\n" : "\n";
  const lines = inner.split(/\r?\n/);
  const out: string[] = [];
  let sawGeneratedAt = false;
  let sawSources = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^generatedAt\s*:/.test(line)) {
      out.push(`generatedAt: ${stamp.generatedAt}`);
      sawGeneratedAt = true;
      continue;
    }
    const src = line.match(/^sources\s*:\s*(.*)$/);
    if (src) {
      let claimed: string[];
      if (src[1].trim()) {
        claimed = parseInlineList(src[1]);
      } else {
        // Block list: the "- item" lines that follow.
        claimed = [];
        while (i + 1 < lines.length && /^\s*-\s+/.test(lines[i + 1])) {
          claimed.push(unquote(lines[i + 1].replace(/^\s*-\s+/, "")));
          i++;
        }
      }
      out.push(`sources: ${formatList(mergeSources(claimed.filter(Boolean), stamp.knowledgeSources))}`);
      sawSources = true;
      continue;
    }
    out.push(line);
  }
  if (!sawGeneratedAt) {
    const fileLine = out.findIndex((l) => /^file\s*:/.test(l));
    out.splice(fileLine >= 0 ? fileLine + 1 : out.length, 0, `generatedAt: ${stamp.generatedAt}`);
  }
  if (!sawSources) out.push(`sources: ${formatList(mergeSources([], stamp.knowledgeSources))}`);

  return `${bom}---${eol}${out.join(eol)}${eol}---${eol}${content.slice(whole.length)}`;
}
