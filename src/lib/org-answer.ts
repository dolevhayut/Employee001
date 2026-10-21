// The company's answer is one text with citation markers, `[[twin-id]]` (or
// `[[a, b]]`), right after the claim they back. This splits it into parts the
// citations UI renders: each cited part carries the ids that follow it.

export type AnswerPart = { text: string; cite?: string[] };

const MARKER = /\s*\[\[([^\]]+)\]\]/g;

export function parseCitedAnswer(answer: string, known: Set<string>): AnswerPart[] {
  const parts: AnswerPart[] = [];
  let last = 0;
  for (const m of answer.matchAll(MARKER)) {
    const ids = m[1]
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter((id) => known.has(id));
    let text = answer.slice(last, m.index);
    // Punctuation right after a marker closes the previous claim, not this one.
    const lead = /^[.,;:!?)\]]+/.exec(text)?.[0];
    if (lead && parts.length) {
      parts[parts.length - 1].text += lead;
      text = text.slice(lead.length);
    }
    if (text) parts.push(ids.length ? { text, cite: ids } : { text });
    else if (ids.length && parts.length) parts[parts.length - 1].cite = [...new Set([...(parts[parts.length - 1].cite ?? []), ...ids])];
    last = m.index! + m[0].length;
  }
  // While streaming, hide a marker that has started but not closed yet.
  let tail = answer.slice(last).replace(/\s*\[\[?[^\]]*$/, "");
  const lead = /^[.,;:!?)\]]+/.exec(tail)?.[0];
  if (lead && parts.length) {
    parts[parts.length - 1].text += lead;
    tail = tail.slice(lead.length);
  }
  if (tail) parts.push({ text: tail });
  return parts;
}
