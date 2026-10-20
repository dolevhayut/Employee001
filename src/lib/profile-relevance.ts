// Picks which of a twin's profile files a question actually touches.
//
// The whole profile is already in the twin's (prompt-cached) system prompt, so
// this never adds or removes context. It decides what the UI shows as
// "recalled": the memory graph lights only the files that matter for this
// question, and nothing at all for small talk. No model call, a few ms.

import fs from "fs";
import path from "path";

export const PROFILE_FILES = [
  "EXPERTISE.md",
  "TONE.md",
  "CONTEXT.md",
  "DECISIONS.md",
  "PREFERENCES.md",
  "PEOPLE.md",
  "PROJECTS.md",
  "BOUNDARIES.md",
  "EMPLOYMENT.md",
] as const;

export type ProfileFile = (typeof PROFILE_FILES)[number];

// Question words that point at one file even when the file text doesn't
// repeat them (English + Hebrew).
const HINTS: Record<ProfileFile, RegExp> = {
  "EXPERTISE.md": /\b(how (do|would|should)|expert|skill|best practice|approach|technical|explain)\b|איך|מומחי|ניסיון/i,
  "TONE.md": /\b(tone|voice|write|draft|reply|email|message|wording)\b|נסח|ניסוח|טון|מייל|הודעה/i,
  "CONTEXT.md": /\b(context|background|status|situation|update|week|today)\b|רקע|מצב|עדכון|השבוע|היום/i,
  "DECISIONS.md": /\b(decide|decision|why did|choose|chose|trade-?off|should we)\b|החלט|למה בחר|כדאי/i,
  "PREFERENCES.md": /\b(prefer|preference|like to|style|tools? you use)\b|מעדיף|העדפ|סגנון/i,
  "PEOPLE.md": /\b(who|team|colleague|owner|owns|manager|report|people|customer)\b|מי |צוות|עמית|אחראי|לקוח/i,
  "PROJECTS.md": /\b(project|roadmap|launch|deadline|milestone|ticket|issue|sprint|working on)\b|פרויקט|רודמפ|השקה|דדליין|משימ|תקל/i,
  "BOUNDARIES.md": /\b(salary|compensation|legal|fire|hire|hiring|confidential|allowed|can you)\b|שכר|משפט|פיטור|גיוס|סודי|מותר/i,
  "EMPLOYMENT.md": /\b(role|title|joined|tenure|contract|hours|vacation|employment)\b|תפקיד|ותק|חוזה|חופש|העסקה/i,
};

const STOP = new Set(
  "the a an and or but of to in on for with at by from is are was were be been it this that these those what which who whom how why when where do does did can could should would will you your our we i me my about into than then them they their there here have has had not no yes please just also more most very any some all each hello thanks thank good morning evening night nice great cool okay bye have day sure tomorrow שלום תודה בוקר ערב טוב אחלה יום".split(
    " ",
  ),
);

function terms(text: string): string[] {
  return [
    ...new Set(
      text
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((w) => w.length >= 3 && !STOP.has(w)),
    ),
  ];
}

/**
 * Score each profile file against the question and return the relevant ones,
 * best first, at most `max`. Rare words count more than words every file has.
 */
export function pickRelevantProfileFiles(
  employeeDir: string,
  question: string,
  max = 3,
  read: (file: string) => string = (f) => fs.readFileSync(path.join(employeeDir, f), "utf8"),
): ProfileFile[] {
  const q = terms(question);
  const docs = new Map<ProfileFile, string>();
  for (const f of PROFILE_FILES) {
    try {
      docs.set(f, read(f).toLowerCase());
    } catch {
      // missing file: never recalled
    }
  }
  if (docs.size === 0) return [];

  const scored = [...docs].map(([file, body]) => {
    let score = HINTS[file].test(question) ? 2 : 0;
    for (const term of q) {
      if (!body.includes(term)) continue;
      const df = [...docs.values()].filter((d) => d.includes(term)).length;
      score += Math.log(1 + docs.size / df);
    }
    return { file, score };
  });

  return scored
    .filter((s) => s.score >= 1.5)
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((s) => s.file);
}
