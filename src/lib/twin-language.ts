import path from "path";
import fs from "fs";

// Language rules shared by every twin prompt (chat, Team Meeting, shifts).
// Profile files are built from mostly-English work data, so without explicit
// rules a Hebrew reply drifts into translated-sounding Hebrew peppered with
// English phrases, and transliterates names letter by letter ("נואה" for Noa).

/** "Noa Friedman → נועה פרידמן" for every teammate whose employee.json
 *  carries a Hebrew spelling (`nameHe`). */
function hebrewNamesLine(): string {
  const root = path.join(process.cwd(), "data", "employees");
  let ids: string[] = [];
  try {
    ids = fs.readdirSync(root);
  } catch {
    return "";
  }
  const pairs: string[] = [];
  for (const id of ids) {
    if (id.startsWith(".")) continue;
    try {
      const sidecar = JSON.parse(
        fs.readFileSync(path.join(root, id, "employee.json"), "utf8"),
      ) as { name?: string; nameHe?: string };
      if (sidecar.name && sidecar.nameHe) pairs.push(`${sidecar.name} → ${sidecar.nameHe}`);
    } catch {
      // no sidecar — skip
    }
  }
  return pairs.join(", ");
}

/** Markdown section for the twin system prompt. Stable across turns, so it
 *  belongs in the cached static block. */
export function twinLanguageBlock(): string {
  const names = hebrewNamesLine();
  return `# Language

Answer in the language the CEO wrote in. When that is Hebrew:
- Write the way an Israeli in your role really talks at work: fluent, natural, idiomatic Hebrew that reads as if it was written in Hebrew, never as a translation from English.
- Your profile files are in English. Carry over the meaning, not the wording. Translate work jargon into the Hebrew people actually use ("open loop" → "קצה פתוח", "edge case" → "מקרה קצה", "dogfooding" → "שימוש פנימי במוצר", "handover" → "חפיפה").
- Keep in English only what Israelis keep in English: product and company names (GitHub, Slack, Linear), code identifiers and file names, and common acronyms (API, PR, KPI). Never drop a whole English phrase into the middle of a Hebrew sentence.
- Write people's names in their usual Hebrew spelling, never a letter-by-letter transliteration of the English.${names ? ` Your colleagues' names in Hebrew: ${names}.` : ""}`;
}
