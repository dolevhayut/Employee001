// Code-level guard against profiling and personal data in what twins keep.
//
// The twin builder's prompt already forbids recording special-category data
// (GDPR Art. 9), performance or loyalty judgments and work-hour patterns,
// but a prompt is not a control. Everything the builder writes into profile
// files and everything memory stores passes through these filters:
//   filterProfilingContent: drops lines that profile the person
//   redactSensitive:        replaces secrets and personal identifiers
// Patterns cover English and Hebrew. They err toward removal: a dropped line
// in a profile file costs less than a stored health or loyalty judgment.

export type ProfilingCategory = "special_category" | "performance_judgment" | "work_hours";

const SPECIAL_CATEGORY: RegExp[] = [
  // Health
  /\b(?:sick(?:ness)?|illness|ill health|diagnos(?:is|ed)|pregnan(?:t|cy)|maternity leave|cancer|chemo(?:therapy)?|depress(?:ion|ed)|anxiety|panic attacks?|burn-?out|therap(?:y|ist)|psychiatri\w*|medication|disabilit(?:y|ies)|disabled|adhd|autis(?:m|tic)|surgery|mental health|chronic (?:pain|condition)|medical (?:leave|condition|history))\b/i,
  /(?:מחלה|חול(?:ה|ת|ים)\b|אבחנ|אובחן|אובחנה|הריון|בהריון|חופשת לידה|סרטן|כימותרפיה|דיכאון|חרדה|התקפי חרדה|שחיקה|פסיכולוג|פסיכיאטר|תרופות|נכות|ניתוח|בריאות הנפש|מצב רפואי)/,
  // Trade union
  /\b(?:trade union|labou?r union|union (?:member|membership|rep(?:resentative)?|organi[sz]\w*)|unioni[sz]\w*|works council|collective (?:agreement|bargaining)|on strike|went on strike)\b/i,
  /(?:ועד (?:ה)?עובדים|איגוד מקצועי|ההסתדרות|הסתדרות העובדים|שביתה|שובת|הסכם קיבוצי|התאגדות)/,
  // Religion or belief
  /\b(?:religio(?:n|us)|observant|keeps? (?:kosher|shabbat|sabbath|halal)|prays?|praying|church|mosque|synagogue|muslim|christian|jewish|orthodox jew|atheist|ramadan)\b/i,
  /(?:דתי(?:ה|ים|ות)?\b|חרדי|שומר(?:ת)? שבת|שומר(?:ת)? כשרות|מתפלל|בית כנסת|מסגד|כנסייה|מוסלמי|נוצרי|חילוני|אתאיסט|רמדאן)/,
  // Sexual orientation, sex life, gender identity
  /\b(?:gay|lesbian|bisexual|transgender|queer|sexual orientation|sex life|coming out)\b/i,
  /(?:הומו(?:סקסואל)?|לסבית|ביסקסואל|טרנס(?:ג'נדר)?|נטייה מינית|יצא מהארון)/,
  // Racial or ethnic origin, political opinions, criminal records, biometrics
  /\b(?:ethnicity|ethnic origin|racial|race:|political (?:views|opinions|affiliation)|votes? for|party member(?:ship)?|criminal record|convicted|biometric|genetic)\b/i,
  /(?:מוצא עדתי|מוצא אתני|דעות פוליטיות|מצביע ל|חבר מפלגה|עבר פלילי|הורשע|ביומטרי|גנטי)/,
];

const PERFORMANCE_JUDGMENT: RegExp[] = [
  /\b(?:under-?perform\w*|low(?:est)?[- ]perform\w*|poor perform\w*|weak (?:performer|link)|performance (?:issues?|problems?|concerns?|improvement plan)|\bPIP\b|lazy|slacker|incompetent|not (?:committed|engaged|a team player)|lacks? commitment|disloyal|not loyal|loyalty (?:is|issues?)|flight risk|(?:looking|interviewing) (?:for|elsewhere|for another job)|job[- ]hunting|(?:should|will) be (?:fired|let go|replaced)|ready to quit|checked out|quiet[- ]quitting)\b/i,
  /(?:עצלן|עצלנית|לא מחויב|חוסר מחויבות|לא נאמן|לא נאמנה|חוסר נאמנות|ביצועים (?:נמוכים|חלשים)|עובד(?:ת)? חלש|תפקוד לקוי|מחפש(?:ת)? עבודה|בראיונות עבודה|צריך לפטר|יפוטר|על הכוונת|סיכון עזיבה)/,
];

const WORK_HOURS: RegExp[] = [
  /\b(?:logs? (?:in|on|off)|online|offline|active|works?|working|leaves?|arrives?|starts? (?:work|the day)|signs? off|replies?)\b[^.\n]{0,40}?\b(?:\d{1,2}(?::\d{2})?\s?(?:am|pm)|\d{1,2}:\d{2}|midnight|late at night|early (?:in the )?morning|after hours|weekends?|on (?:saturdays?|sundays?|fridays?))\b/i,
  /\b(?:always online|never offline|works? (?:late|long hours|overtime|weekends)|(?:usually|often|rarely) (?:online|offline|available) (?:after|before|until))\b/i,
  /(?:עובד(?:ת)? עד (?:מאוחר|השעות הקטנות)|מחובר(?:ת)? (?:ב|עד )(?:שעה|חצות)|יוצא(?:ת)? מוקדם|מגיע(?:ה)? (?:ב|אחרי )(?:\d|שעה)|עובד(?:ת)? בסופי שבוע|עובד(?:ת)? בשבת|זמין(?:ה)? עד|שעות נוספות)/,
];

const CATEGORIES: Array<[ProfilingCategory, RegExp[]]> = [
  ["special_category", SPECIAL_CATEGORY],
  ["performance_judgment", PERFORMANCE_JUDGMENT],
  ["work_hours", WORK_HOURS],
];

export function profilingCategoryOf(text: string): ProfilingCategory | null {
  for (const [category, patterns] of CATEGORIES) {
    if (patterns.some((re) => re.test(text))) return category;
  }
  return null;
}

export type FilterResult = { text: string; removed: Array<{ category: ProfilingCategory; line: string }> };

/** Profile files whose job is to name sensitive topics to stay away from. */
const EXEMPT_FILES = new Set(["BOUNDARIES.md"]);

/** A YAML frontmatter block at the very top of a profile file. */
const FRONTMATTER_RE = /^(﻿?---[ \t]*\r?\n)([\s\S]*?)(\r?\n---[ \t]*(?:\r?\n|$))/;
/** Quoted so YAML reads it as a string, not as a one-item list. */
const REDACTED_VALUE = '"[redacted]"';

/** Items of an inline YAML list body, split on commas outside quotes. */
function splitInlineList(body: string): string[] {
  const items: string[] = [];
  let current = "";
  let quote = "";
  for (const ch of body) {
    if (quote) {
      if (ch === quote) quote = "";
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === ",") {
      items.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) items.push(current.trim());
  return items;
}

/**
 * Frontmatter lines are structure, not prose: dropping `sources:` because a
 * filename in it looks sensitive leaves the file without the key its readers
 * expect. Keys stay; only the flagged value, list item or loose line goes.
 */
function filterFrontmatterLines(inner: string, removed: FilterResult["removed"]): string {
  const out: string[] = [];
  for (const line of inner.split("\n")) {
    const category = profilingCategoryOf(line);
    if (!category) {
      out.push(line);
      continue;
    }
    const cr = line.endsWith("\r") ? "\r" : "";
    const bare = cr ? line.slice(0, -1) : line;
    const item = bare.match(/^(\s*-\s+)(.*)$/);
    if (item) {
      // Block-list item (e.g. under `sources:`): keep the slot, hide the value.
      removed.push({ category, line: item[2].trim() });
      out.push(`${item[1]}${REDACTED_VALUE}${cr}`);
      continue;
    }
    const kv = bare.match(/^(\s*[A-Za-z0-9_][\w.-]*\s*:)(\s*)(.*)$/);
    if (!kv || profilingCategoryOf(kv[1])) {
      // Not a key, or a key that itself profiles the person: no structure to keep.
      removed.push({ category, line: bare.trim() });
      continue;
    }
    const [, key, space, value] = kv;
    const list = value.trim().match(/^\[(.*)\]$/);
    if (list) {
      const items = splitInlineList(list[1]).map((it) => {
        const c = profilingCategoryOf(it);
        if (!c) return it;
        removed.push({ category: c, line: it });
        return REDACTED_VALUE;
      });
      out.push(`${key}${space || " "}[${items.join(", ")}]${cr}`);
      continue;
    }
    removed.push({ category, line: bare.trim() });
    out.push(`${key} ${REDACTED_VALUE}${cr}`);
  }
  return out.join("\n");
}

/**
 * Drop every line (or, inside a paragraph, every sentence) that profiles the
 * person. Headings stay so the file keeps its shape. For a named profile file,
 * a leading YAML frontmatter block keeps its keys: sensitive values in it are
 * redacted in place instead of the line being dropped.
 */
export function filterProfilingContent(markdown: string, filename?: string): FilterResult {
  if (filename && EXEMPT_FILES.has(filename)) return { text: markdown, removed: [] };
  const removed: FilterResult["removed"] = [];
  let head = "";
  let body = markdown;
  const fm = filename ? markdown.match(FRONTMATTER_RE) : null;
  if (fm) {
    head = fm[1] + filterFrontmatterLines(fm[2], removed) + fm[3];
    body = markdown.slice(fm[0].length);
  }
  const lines = body.split("\n").flatMap((line) => {
    if (/^\s*#/.test(line)) return [line];
    const category = profilingCategoryOf(line);
    if (!category) return [line];
    // A list item goes whole; prose loses only the offending sentences.
    if (/^\s*(?:[-*+]|\d+\.)\s/.test(line)) {
      removed.push({ category, line: line.trim() });
      return [];
    }
    const kept = line.split(/(?<=[.!?])\s+/).filter((sentence) => {
      const c = profilingCategoryOf(sentence);
      if (c) removed.push({ category: c, line: sentence.trim() });
      return !c;
    });
    return kept.length ? [kept.join(" ")] : [];
  });
  return { text: head + lines.join("\n"), removed };
}

// ─── Personal-data redaction ────────────────────────────────────────────────

export type RedactionLevel = "off" | "basic" | "strict";

/** EMPLOYEE001_MEMORY_REDACT=off|basic|strict (default basic). Secrets are
 *  redacted at every level. */
export function memoryRedactionLevel(env: Record<string, string | undefined> = process.env): RedactionLevel {
  const v = env.EMPLOYEE001_MEMORY_REDACT?.trim().toLowerCase();
  return v === "off" || v === "strict" ? v : "basic";
}

function luhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

function redactSecrets(text: string): string {
  return text
    .replace(/sk-ant-[a-zA-Z0-9_-]{16,}/g, "[redacted_anthropic_key]")
    .replace(/sk-[a-zA-Z0-9_-]{16,}/g, "[redacted_openai_key]")
    .replace(/\bak_[a-zA-Z0-9_-]{12,}/g, "[redacted_api_key]")
    .replace(/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g, "[redacted_token]")
    .replace(/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, "[redacted_token]")
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, "[redacted_token]")
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9._-]{10,}\b/g, "[redacted_token]")
    .replace(/Bearer\s+[a-zA-Z0-9._-]{16,}/gi, "Bearer [redacted]")
    .replace(/((?:api[_-]?key|token|secret|password|passwd)["'\s:=]+)[^\s"']{8,}/gi, "$1[redacted]");
}

/**
 * Replace secrets and personal identifiers. basic: emails, phone numbers,
 * national IDs (Israeli ID, US SSN), IBANs, payment cards, and sentences with
 * special-category data. strict adds IP addresses and any 6+ digit number.
 */
export function redactSensitive(text: string, level: RedactionLevel = "basic"): string {
  let out = redactSecrets(text ?? "");
  if (level === "off") return out;
  out = out
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "[email]")
    .replace(/\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){3,7}(?:\s?[A-Z0-9]{1,3})?\b/g, "[iban]")
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, "[national_id]")
    .replace(/\b(?:\d[ -]?){13,19}\b/g, (m) => (luhn(m.replace(/\D/g, "")) ? "[card]" : m))
    .replace(/(?<![\w-])(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?){2,4}\d{2,4}(?![\w-])/g, (m) => {
      const digits = m.replace(/\D/g, "");
      if (digits.length === 9 && !/[\s.()+-]/.test(m.trim())) return "[national_id]";
      return digits.length >= 9 && digits.length <= 15 ? "[phone]" : m;
    })
    .replace(/(?:ת\.?ז\.?|תעודת זהות|ID (?:number|no\.?)|passport(?: no\.?| number)?)\s*:?\s*[A-Z0-9-]{5,12}/gi, "[national_id]");
  // Special-category data: drop the sentence, keep the rest.
  out = out.replace(/[^.!?\n]+[.!?]?/g, (sentence) =>
    SPECIAL_CATEGORY.some((re) => re.test(sentence))
      ? `${/^\s/.test(sentence) ? " " : ""}[redacted: sensitive personal data]`
      : sentence,
  );
  if (level === "strict") {
    out = out
      .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[ip]")
      .replace(/\b\d{6,}\b/g, "[number]");
  }
  return out;
}
