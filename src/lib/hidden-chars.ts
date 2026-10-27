// Strip characters a reader can't see but a model reads: the "ASCII
// smuggling" channel for prompt injection. Pure, so every intake point and
// its tests can share it; callers decide how to record what was removed.
//
// The strip set comes from Unicode properties, not a hand-picked list:
// every Default_Ignorable_Code_Point and every format character (Cf), plus
// the Hangul fillers U+115F, U+1160, U+3164 and U+FFA0 (they render blank).
// That covers tag characters, bidi controls, zero-width characters, soft
// hyphens, variation selectors and whatever future Unicode versions add to
// those properties.
//
// A few of those characters do real work in real text, so they survive only
// in the context that work needs (anywhere else they go):
//   LRM, RLM, ALM   U+200E, U+200F, U+061C: Hebrew and Arabic text needs
//                   them. A run of two or more collapses to the first.
//   ZWJ  U+200D     only between two emoji (family, profession, flag
//                   sequences). Between letters it is the classic zero-width
//                   bit channel. Indic/Arabic ligature control loses it.
//   ZWNJ U+200C     only between two non-ASCII letters (a letter or a
//                   combining mark before it, for the Indic virama), as in
//                   Persian and Indic words.
//   CGJ  U+034F     only directly after a combining mark (pointed Hebrew
//                   uses it to order vowel points).
//   VS15/VS16       U+FE0E/U+FE0F only after a (non-ASCII) emoji, or in a
//                   keycap: [0-9#*] U+FE0F U+20E3.
//   VS1–VS14, VS17+ U+FE00–U+FE0D and U+E0100–U+E01EF only after a CJK
//                   ideograph (ideographic variation sequences). Unicode has
//                   no property for "has a standardized variation sequence",
//                   so the rarer math, Myanmar, Phags-pa and Mongolian
//                   variants lose their selector rather than rely on a hand
//                   list; the base character still reads correctly.
//   Subdivision flags  England, Scotland and Wales are spelled with tag
//                   characters after U+1F3F4 and are kept intact.
// Context is judged against the raw neighbours: a kept character next to a
// removed one loses its context and goes too, so a run of ZWJs or variation
// selectors never survives as a whole.
//
// Counted by category:
//   tag        U+E0000–U+E007F
//   bidi       U+202A–U+202E, U+2066–U+2069, and the extra marks of a
//              collapsed LRM/RLM/ALM run
//   zeroWidth  U+200B–U+200D, U+2060–U+2064, U+FEFF (a leading BOM is
//              dropped without being counted: it is an encoding artefact)
//   other      everything else (soft hyphen, variation selectors, CGJ,
//              Mongolian vowel separator, fillers, ...)

export type HiddenCharCategory = "tag" | "bidi" | "zeroWidth" | "other";
export type HiddenCharCounts = Record<HiddenCharCategory, number>;
export type HiddenCharResult = { text: string; removed: HiddenCharCounts; total: number };

export function emptyHiddenCharCounts(): HiddenCharCounts {
  return { tag: 0, bidi: 0, zeroWidth: 0, other: 0 };
}

// Tag spellings of "gbeng", "gbsct", "gbwls" + CANCEL TAG after U+1F3F4.
const SUBDIVISION_FLAG =
  "\\u{1F3F4}\\u{E0067}\\u{E0062}(?:\\u{E0065}\\u{E006E}\\u{E0067}|\\u{E0073}\\u{E0063}\\u{E0074}|\\u{E0077}\\u{E006C}\\u{E0073})\\u{E007F}";

/** Every character this module considers hidden (before context rules). */
export const HIDDEN_CHAR_CLASS = "[\\p{Default_Ignorable_Code_Point}\\p{Cf}\\u115F\\u1160\\u3164\\uFFA0]";

/** Matches any single hidden character, for checks and tests. */
export const HIDDEN_CHAR_RE = new RegExp(HIDDEN_CHAR_CLASS, "u");

const CANDIDATE = new RegExp(`(${SUBDIVISION_FLAG})|${HIDDEN_CHAR_CLASS}`, "gu");

const ZWNJ = 0x200c;
const ZWJ = 0x200d;
const CGJ = 0x034f;
const VS15 = 0xfe0e;
const VS16 = 0xfe0f;
const KEYCAP = 0x20e3;
const DIRECTIONAL_MARKS = new Set([0x200e, 0x200f, 0x061c]);

const PICTOGRAPHIC = /^\p{Extended_Pictographic}$/u;
const EMOJI_MODIFIER = /^\p{Emoji_Modifier}$/u;
const EMOJI = /^\p{Emoji}$/u;
const MARK = /^\p{M}$/u;
const LETTER_OR_MARK = /^[\p{L}\p{M}]$/u;
const LETTER = /^\p{L}$/u;
const IDEOGRAPH = /^\p{Ideographic}$/u;

const is = (re: RegExp, cp: number | undefined): boolean => cp !== undefined && re.test(String.fromCodePoint(cp));
const nonAscii = (cp: number | undefined): cp is number => cp !== undefined && cp > 0x7f;
const isKeycapBase = (cp: number | undefined): boolean =>
  cp !== undefined && ((cp >= 0x30 && cp <= 0x39) || cp === 0x23 || cp === 0x2a);

function category(cp: number): HiddenCharCategory {
  if (cp >= 0xe0000 && cp <= 0xe007f) return "tag";
  if ((cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2066 && cp <= 0x2069) || DIRECTIONAL_MARKS.has(cp)) return "bidi";
  if ((cp >= 0x200b && cp <= 0x200d) || (cp >= 0x2060 && cp <= 0x2064) || cp === 0xfeff) return "zeroWidth";
  return "other";
}

/**
 * Whether a hidden character does legitimate work between `prev` and `next`
 * (raw neighbours; `prev` is undefined when the neighbour was removed or
 * there is none). Directional marks are handled by the caller.
 */
function keepInContext(cp: number, prev: number | undefined, next: number | undefined): boolean {
  if (cp === ZWJ) {
    const joinsAfter = is(PICTOGRAPHIC, prev) || is(EMOJI_MODIFIER, prev) || prev === VS16;
    return joinsAfter && is(PICTOGRAPHIC, next);
  }
  if (cp === ZWNJ) return nonAscii(prev) && is(LETTER_OR_MARK, prev) && nonAscii(next) && is(LETTER, next);
  if (cp === CGJ) return is(MARK, prev);
  if (cp === VS15 || cp === VS16) {
    if (isKeycapBase(prev)) return cp === VS16 && next === KEYCAP;
    return nonAscii(prev) && is(EMOJI, prev);
  }
  if ((cp >= 0xfe00 && cp <= 0xfe0d) || (cp >= 0xe0100 && cp <= 0xe01ef)) return is(IDEOGRAPH, prev);
  return false;
}

/** The code point that ends just before `index` (surrogate-pair aware). */
function codePointBefore(text: string, index: number): number | undefined {
  if (index <= 0) return undefined;
  const low = text.charCodeAt(index - 1);
  const start = low >= 0xdc00 && low <= 0xdfff && index >= 2 ? index - 2 : index - 1;
  return text.codePointAt(start);
}

/**
 * Remove invisible characters that can carry hidden instructions. Returns the
 * cleaned text and how many characters (code points) went, per category.
 * Idempotent: cleaning clean text changes nothing.
 */
export function stripHiddenChars(input: string): HiddenCharResult {
  const removed = emptyHiddenCharCounts();
  if (!input) return { text: input, removed, total: 0 };

  // A leading BOM is an encoding artefact, not an attack: drop it uncounted.
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;

  const out: string[] = [];
  let lastEnd = 0;
  let lastRemoved = false;
  // Whether the output so far ends with a directional mark (for collapsing
  // runs, judged on what the reader sees, so "RLM ZWSP RLM" collapses too).
  let endsWithMark = false;

  for (const match of text.matchAll(CANDIDATE)) {
    const index = match.index;
    const end = index + match[0].length;
    if (index > lastEnd) {
      out.push(text.slice(lastEnd, index));
      endsWithMark = false;
    }
    let keep: boolean;
    if (match[1]) {
      keep = true;
      endsWithMark = false;
    } else {
      const cp = match[0].codePointAt(0)!;
      if (DIRECTIONAL_MARKS.has(cp)) {
        keep = !endsWithMark;
        if (keep) endsWithMark = true;
      } else {
        const prev = index === lastEnd && lastRemoved ? undefined : codePointBefore(text, index);
        keep = keepInContext(cp, prev, text.codePointAt(end));
        if (keep) endsWithMark = false;
      }
      if (!keep) removed[category(cp)] += 1;
    }
    if (keep) out.push(match[0]);
    lastEnd = end;
    lastRemoved = !keep;
  }
  if (lastEnd === 0) return { text, removed, total: 0 };
  out.push(text.slice(lastEnd));

  const total = hiddenCharTotal(removed);
  return { text: out.join(""), removed, total };
}

/** Add `b` into `a` (in place) and return `a`. */
export function addHiddenCharCounts(a: HiddenCharCounts, b: HiddenCharCounts): HiddenCharCounts {
  a.tag += b.tag;
  a.bidi += b.bidi;
  a.zeroWidth += b.zeroWidth;
  a.other += b.other;
  return a;
}

export function hiddenCharTotal(counts: HiddenCharCounts): number {
  return counts.tag + counts.bidi + counts.zeroWidth + counts.other;
}

/**
 * Clean several optional string fields of one record at once (e.g. an email's
 * from/subject/body), summing the counts. Absent fields stay absent.
 */
export function stripHiddenCharsFields<T extends Record<string, unknown>, K extends keyof T>(
  value: T,
  keys: readonly K[],
): { value: T; removed: HiddenCharCounts; total: number } {
  const removed = emptyHiddenCharCounts();
  const out: T = { ...value };
  for (const key of keys) {
    const field = value[key];
    if (typeof field !== "string") continue;
    const result = stripHiddenChars(field);
    out[key] = result.text as T[K];
    addHiddenCharCounts(removed, result.removed);
  }
  return { value: out, removed, total: hiddenCharTotal(removed) };
}

const MAX_WALK_DEPTH = 64;

/**
 * Clean every string (values and keys) inside a JSON-like value, e.g. a
 * provider response or tool result that will reach a prompt. Returns a copy.
 */
export function stripHiddenCharsDeep(value: unknown): { value: unknown; removed: HiddenCharCounts; total: number } {
  const removed = emptyHiddenCharCounts();
  const walk = (node: unknown, depth: number): unknown => {
    if (typeof node === "string") {
      const result = stripHiddenChars(node);
      addHiddenCharCounts(removed, result.removed);
      return result.text;
    }
    if (node === null || typeof node !== "object") return node;
    if (depth > MAX_WALK_DEPTH) {
      // Deeper than any real payload: clean the subtree as JSON text (hidden
      // characters are never JSON syntax, so the shape survives) rather than
      // let it through raw.
      try {
        const result = stripHiddenChars(JSON.stringify(node));
        addHiddenCharCounts(removed, result.removed);
        return JSON.parse(result.text) as unknown;
      } catch {
        return "[value too deeply nested]";
      }
    }
    if (Array.isArray(node)) return node.map((item) => walk(item, depth + 1));
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(node as Record<string, unknown>)) {
      out[walk(key, depth + 1) as string] = walk(item, depth + 1);
    }
    return out;
  };
  const cleaned = walk(value, 0);
  return { value: cleaned, removed, total: hiddenCharTotal(removed) };
}

/** "3 tag, 1 zero-width": a short, payload-free description for logs. */
export function describeHiddenChars(counts: HiddenCharCounts): string {
  const parts: string[] = [];
  if (counts.tag) parts.push(`${counts.tag} tag`);
  if (counts.bidi) parts.push(`${counts.bidi} bidi control`);
  if (counts.zeroWidth) parts.push(`${counts.zeroWidth} zero-width`);
  if (counts.other) parts.push(`${counts.other} other invisible`);
  return parts.join(", ") || "none";
}
