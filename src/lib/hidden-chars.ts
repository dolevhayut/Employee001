// Strip characters a reader can't see but a model reads: the "ASCII
// smuggling" channel for prompt injection. Pure, so every intake point and
// its tests can share it; callers decide how to record what was removed.
//
// What goes, by category:
//   tag        U+E0000–U+E007F. Tag characters mirror ASCII invisibly, so a
//              whole instruction can ride inside an innocent-looking line.
//              The three RGI subdivision flags (England, Scotland, Wales) are
//              the only legitimate use and are kept intact.
//   bidi       Embeddings/overrides U+202A–U+202E and isolates U+2066–U+2069
//              ("Trojan Source": text that displays differently from how it
//              reads). LRM/RLM (U+200E/U+200F) and ALM (U+061C) stay: Hebrew
//              and Arabic text needs them, and alone they carry no payload.
//   zeroWidth  U+200B, U+200C, U+2060–U+2064, U+FEFF, and U+200D (ZWJ) when
//              it doesn't join two emoji (see below). A leading BOM is
//              dropped without being counted: it is an encoding artefact.
//   other      U+180E (Mongolian vowel separator, an ex-space), U+00AD (soft
//              hyphen, splits keywords invisibly), U+206A–U+206F (deprecated
//              format controls), U+FFF9–U+FFFB (interlinear annotation),
//              U+115F/U+1160/U+3164/U+FFA0 (Hangul fillers, render blank),
//              U+E0100–U+E01EF (variation-selector supplement, a known
//              "emoji smuggling" byte channel), and every variation selector
//              after the first in a run of U+FE00–U+FE0F (one is legitimate
//              emoji/text presentation; two in a row never are).
//
// Kept on purpose:
//   ZWJ (U+200D) between two emoji (an Extended_Pictographic, skin-tone
//   modifier or U+FE0F before it, an Extended_Pictographic after it), as in
//   family, profession and flag sequences. Anywhere else it is stripped: a
//   ZWJ between ASCII letters is the classic zero-width binary encoding. The
//   cost is Indic/Arabic text that uses ZWJ for ligature control, rare for
//   this product's (English/Hebrew) audience and still readable without it.
//   CGJ (U+034F) stays: pointed Hebrew uses it to order vowel marks, and a
//   single invisible joiner is a poor smuggling channel.

export type HiddenCharCategory = "tag" | "bidi" | "zeroWidth" | "other";
export type HiddenCharCounts = Record<HiddenCharCategory, number>;
export type HiddenCharResult = { text: string; removed: HiddenCharCounts; total: number };

export function emptyHiddenCharCounts(): HiddenCharCounts {
  return { tag: 0, bidi: 0, zeroWidth: 0, other: 0 };
}

// Tag spellings of "gbeng", "gbsct", "gbwls" + CANCEL TAG after U+1F3F4.
const SUBDIVISION_FLAG =
  "\u{1F3F4}\u{E0067}\u{E0062}(?:\u{E0065}\u{E006E}\u{E0067}|\u{E0073}\u{E0063}\u{E0074}|\u{E0077}\u{E006C}\u{E0073})\u{E007F}";

const HIDDEN = new RegExp(
  [
    `(${SUBDIVISION_FLAG})`, // 1: keep
    "([\\u{E0000}-\\u{E007F}])", // 2: tag
    "([\\u202A-\\u202E\\u2066-\\u2069])", // 3: bidi
    "([\\u200B\\u200C\\u2060-\\u2064\\uFEFF])", // 4: zero width
    "([\\u180E\\u00AD\\u206A-\\u206F\\uFFF9-\\uFFFB\\u115F\\u1160\\u3164\\uFFA0\\u{E0100}-\\u{E01EF}])", // 5: other
    "([\\uFE00-\\uFE0F])([\\uFE00-\\uFE0F]+)", // 6, 7: variation-selector run
  ].join("|"),
  "gu",
);

const ZWJ = /‍/g;
const JOINS_AFTER = /^[\p{Extended_Pictographic}\p{Emoji_Modifier}️]$/u;
const JOINS_BEFORE = /^\p{Extended_Pictographic}$/u;

/** The code point that ends just before `index` (surrogate-pair aware). */
function codePointBefore(text: string, index: number): string {
  if (index <= 0) return "";
  const low = text.charCodeAt(index - 1);
  const start = low >= 0xdc00 && low <= 0xdfff && index >= 2 ? index - 2 : index - 1;
  return String.fromCodePoint(text.codePointAt(start)!);
}

function codePointAt(text: string, index: number): string {
  const cp = text.codePointAt(index);
  return cp === undefined ? "" : String.fromCodePoint(cp);
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
  let text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;

  text = text.replace(HIDDEN, (match, flag, tag, bidi, zw, other, firstVs, extraVs: string | undefined) => {
    if (flag) return match;
    if (tag) removed.tag += 1;
    else if (bidi) removed.bidi += 1;
    else if (zw) removed.zeroWidth += 1;
    else if (other) removed.other += 1;
    else if (firstVs) {
      removed.other += [...(extraVs ?? "")].length;
      return firstVs;
    }
    return "";
  });

  // ZWJ last, judged against the text cleaned above. Neighbours are read
  // from that text before any ZWJ is removed, so a ZWJ beside another ZWJ
  // never counts as joining two emoji and a whole run goes.
  text = text.replace(ZWJ, (_match, offset: number, whole: string) => {
    const before = codePointBefore(whole, offset);
    const after = codePointAt(whole, offset + 1);
    if (JOINS_AFTER.test(before) && JOINS_BEFORE.test(after)) return "‍";
    removed.zeroWidth += 1;
    return "";
  });

  const total = removed.tag + removed.bidi + removed.zeroWidth + removed.other;
  return { text, removed, total };
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

/** "3 tag, 1 zero-width": a short, payload-free description for logs. */
export function describeHiddenChars(counts: HiddenCharCounts): string {
  const parts: string[] = [];
  if (counts.tag) parts.push(`${counts.tag} tag`);
  if (counts.bidi) parts.push(`${counts.bidi} bidi control`);
  if (counts.zeroWidth) parts.push(`${counts.zeroWidth} zero-width`);
  if (counts.other) parts.push(`${counts.other} other invisible`);
  return parts.join(", ") || "none";
}
