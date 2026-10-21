// i18n catalog for "Ask the company": one question to the whole
// organization, one answer back with every claim cited to the twin it came
// from. Hebrew is optional (English fallback); filled in because it is demoed.

export const orgBrainEn = {
  "nav.orgBrain": "Ask the company",
  "shell.cmd.orgBrain.hint": "One question to the whole company, one cited answer",
  "org.title": "Ask the company",
  "org.subtitle": "One question to the whole organization. The twins who know look it up, and you get one answer with every fact traced to who it came from.",
  "org.placeholder": "Ask the company anything…",
  "org.followUp": "Ask another question…",
  "org.send": "Ask",
  "org.routing": "Finding who knows",
  "org.gathering": "Gathering what the team knows",
  "org.source.working": "Looking it up",
  "org.source.tools": "{count} lookups",
  "org.source.empty": "Nothing on this",
  "org.sources": "{count} sources",
  "org.new": "New question",
  "org.noTwin": "No trained twin yet. Train one from the Twins page first.",
  "org.error": "Something went wrong reaching the company. Try again.",
  "org.s1": "Which customers are at risk this quarter, and what are we doing about it?",
  "org.s2": "What are we shipping this month, and what could slip?",
  "org.s3": "Where are we spending the most, and is it worth it?",
} as const;

export const orgBrainHe: Partial<Record<keyof typeof orgBrainEn, string>> = {
  "nav.orgBrain": "שאלו את החברה",
  "shell.cmd.orgBrain.hint": "שאלה אחת לכל החברה, תשובה אחת עם מקורות",
  "org.title": "שאלו את החברה",
  "org.subtitle": "שאלה אחת לכל הארגון. התאומים שיודעים בודקים, ואתם מקבלים תשובה אחת שכל עובדה בה מצוינת עם המקור שלה.",
  "org.placeholder": "שאלו את החברה כל דבר…",
  "org.followUp": "שאלה נוספת…",
  "org.send": "שאל",
  "org.routing": "מחפש מי יודע",
  "org.gathering": "אוסף את מה שהצוות יודע",
  "org.source.working": "בודק",
  "org.source.tools": "{count} בדיקות",
  "org.source.empty": "אין לו מידע",
  "org.sources": "{count} מקורות",
  "org.new": "שאלה חדשה",
  "org.noTwin": "אין עדיין תאום מאומן. אמנו אחד מעמוד התאומים.",
  "org.error": "משהו השתבש בפנייה לחברה. נסו שוב.",
  "org.s1": "אילו לקוחות בסיכון ברבעון הזה, ומה אנחנו עושים בנידון?",
  "org.s2": "מה אנחנו משיקים החודש, ומה עלול להתעכב?",
  "org.s3": "על מה אנחנו מוציאים הכי הרבה, והאם זה שווה את זה?",
};
