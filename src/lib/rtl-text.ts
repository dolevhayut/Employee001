/** The subset of PDF.js text items needed to rebuild horizontal text lines. */
export type PositionedTextItem = {
  str: string;
  x: number;
  y: number;
  height: number;
  dir: string;
};

type TextLine = {
  y: number;
  height: number;
  items: PositionedTextItem[];
};

const HEBREW = /[\u0590-\u05FF]/g;
const LTR_STRONG = /[A-Za-z\u00C0-\u02AF\u0370-\u052F\u1E00-\u1EFF\u2C60-\u2C7F0-9]/g;
const NON_WHITESPACE = /\S+/g;

function characterCount(text: string, pattern: RegExp): number {
  return (text.match(pattern) ?? []).length;
}

function directionOfToken(token: string): "ltr" | "rtl" | null {
  if (HEBREW.test(token)) {
    HEBREW.lastIndex = 0;
    return "rtl";
  }
  HEBREW.lastIndex = 0;
  if (LTR_STRONG.test(token)) {
    LTR_STRONG.lastIndex = 0;
    return "ltr";
  }
  LTR_STRONG.lastIndex = 0;
  return null;
}

/**
 * Turn a visually ordered RTL line into logical order without reversing the
 * contents of embedded LTR runs. PDF.js has already kept characters within
 * an item logical; only the geometrically positioned items need reordering.
 */
export function restoreHebrewLogicalOrder(
  visualLine: string,
  isRtlPdfLine = false
): string {
  const hebrewCount = characterCount(visualLine, HEBREW);
  const ltrCount = characterCount(visualLine, LTR_STRONG);
  if (hebrewCount === 0 || (!isRtlPdfLine && hebrewCount <= ltrCount)) {
    return visualLine;
  }

  const words = [...visualLine.matchAll(NON_WHITESPACE)].map((match) => ({
    value: match[0],
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length,
    direction: directionOfToken(match[0]),
  }));
  const groups: Array<{ direction: "ltr" | "rtl"; words: typeof words }> = [];
  let separatedByNeutral = false;
  for (const word of words) {
    if (word.direction === null) {
      separatedByNeutral = true;
      continue;
    }
    const group = groups.at(-1);
    if (!group || separatedByNeutral || group.direction !== word.direction) {
      groups.push({ direction: word.direction, words: [word] });
    } else {
      group.words.push(word);
    }
    separatedByNeutral = false;
  }
  if (groups.length === 0) return visualLine;

  const renderGroup = (group: (typeof groups)[number]): string => {
    const groupWords = group.direction === "rtl" ? [...group.words].reverse() : group.words;
    return groupWords.map((word) => word.value).join(" ");
  };

  // Neutral punctuation belongs between directional runs. Retaining the text
  // between their original bounding words preserves separators such as " — ".
  const connectors = groups.slice(0, -1).map((group, index) => {
    const next = groups[index + 1];
    return visualLine.slice(group.words.at(-1)!.end, next.words[0].start);
  });

  const renderedGroups = [...groups].reverse().map(renderGroup);
  const reversedConnectors = [...connectors].reverse();
  return renderedGroups.reduce(
    (result, group, index) =>
      index === 0 ? group : result + reversedConnectors[index - 1] + group,
    ""
  );
}

function isSameLine(line: TextLine, item: PositionedTextItem): boolean {
  return Math.abs(line.y - item.y) <= Math.max(2, Math.max(line.height, item.height) * 0.35);
}

/**
 * Rebuild PDF text from positioned PDF.js items. Items are first grouped by
 * baseline and sorted left-to-right by x; RTL-dominant lines are then restored
 * to logical reading order while embedded LTR runs remain intact.
 */
export function textFromPositionedPdfItems(items: readonly PositionedTextItem[]): string {
  const lines: TextLine[] = [];
  for (const item of items) {
    if (item.str === "") continue;
    const line = lines.find((candidate) => isSameLine(candidate, item));
    if (line) {
      line.items.push(item);
      line.height = Math.max(line.height, item.height);
    } else {
      lines.push({ y: item.y, height: item.height, items: [item] });
    }
  }

  return lines
    .sort((a, b) => b.y - a.y)
    .map((line) => {
      const visualLine = [...line.items]
        .sort((a, b) => a.x - b.x)
        .map((item) => item.str)
        .join("");
      const rtlItems = line.items.filter((item) => item.dir === "rtl").length;
      return rtlItems > 0 ? restoreHebrewLogicalOrder(visualLine, true) : visualLine;
    })
    .join("\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
}
