// Text around live voice on Ask, kept pure so it's testable without a mic:
// cutting the twin's streamed answer into sentences to speak, cleaning a
// sentence for speech, and telling the person's voice apart from the twin's
// own voice coming back through the speakers.

/** A run without sentence punctuation is cut at a comma or space past this. */
const LONG_RUN = 180;
/** Shorter pieces ride along with the next sentence ("Yes." "Dr." "1."). */
const MIN_SENTENCE = 12;

// End of a sentence: . ! ? … (Latin or Hebrew text alike), optionally closed
// by quotes or brackets, then whitespace; or a line break.
const BOUNDARY = /[.!?…]+["'”’)\]]*\s+|\n+/g;

/** Splits complete sentences off the front of streamed text. With `final`,
 *  whatever is left is the last sentence. Cites and markdown stay in: clean
 *  each sentence with `speakable` before speaking it. */
export function takeSentences(buf: string, final = false): { sentences: string[]; rest: string } {
  const sentences: string[] = [];
  let start = 0;
  let pending = "";
  for (const m of buf.matchAll(BOUNDARY)) {
    const end = (m.index ?? 0) + m[0].length;
    const piece = pending + buf.slice(start, end);
    start = end;
    if (piece.trim().length < MIN_SENTENCE) {
      pending = piece;
      continue;
    }
    sentences.push(piece.trim());
    pending = "";
  }
  let rest = pending + buf.slice(start);
  // No punctuation for a long stretch: don't hold speech back, cut at a pause.
  while (!final && rest.length > LONG_RUN) {
    const head = rest.slice(0, LONG_RUN);
    const cut = Math.max(head.lastIndexOf(", "), head.lastIndexOf("، "));
    const at = cut > MIN_SENTENCE ? cut + 1 : head.lastIndexOf(" ");
    if (at <= MIN_SENTENCE) break;
    sentences.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trimStart();
  }
  if (final) {
    if (rest.trim()) sentences.push(rest.trim());
    rest = "";
  }
  return { sentences, rest };
}

/** One sentence as it should be said: no [[cite]] markers, no markdown. */
export function speakable(s: string): string {
  return s
    .replace(/\s*\[\[[^\]]*\]\]/g, "")
    .replace(/\[\[[^\]]*$/, "") // a marker cut off at the end
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/#{1,6}\s/g, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^\s*(?:[-*+]|\d+\.)\s+/gm, "")
    .replace(/^>\s/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

const words = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);

/** Real words in a transcript, not a tagged sound like "(laughs)" or "[music]". */
export function heardSpeech(text: string): boolean {
  return words(text.replace(/\([^)]*\)|\[[^\]]*\]/g, " ")).length > 0;
}

/** True when what the mic heard is mostly a run of the twin's own words, in
 *  order: its voice leaking from the speakers back into the mic, not the
 *  person talking. A question that only reuses some of its words ("what is
 *  the budget" over "the budget is forty thousand") is not an echo. */
export function looksLikeEcho(heard: string, spoken: string): boolean {
  const h = words(heard);
  if (h.length === 0) return true;
  const s = words(spoken);
  if (s.length === 0) return false;
  // Longest run of consecutive heard words that also appears, in order, in what was said.
  let best = 0;
  let prev = new Array<number>(s.length + 1).fill(0);
  for (let i = 1; i <= h.length; i++) {
    const row = new Array<number>(s.length + 1).fill(0);
    for (let j = 1; j <= s.length; j++) {
      if (h[i - 1] === s[j - 1]) {
        row[j] = prev[j - 1] + 1;
        if (row[j] > best) best = row[j];
      }
    }
    prev = row;
  }
  return best / h.length >= 0.6;
}
