export const settingsEn = {
  "settings.telemetry.title": "Anonymous usage counts",
  "settings.telemetry.desc": "Off unless you turn it on. Employee001 sends only anonymous counts, never names, text, email addresses, hosts, or paths.",
  "settings.telemetry.toggle": "Share anonymous usage counts",
  "settings.telemetry.on": "On",
  "settings.telemetry.off": "Off",
  "settings.telemetry.preview": "What we send",
  "settings.telemetry.loading": "Loading preview…",
  "settings.telemetry.failed": "Could not update this setting. Try again.",
  "settings.api.elevenLabsHint": "Optional, for voice. Create a restricted key: Text to Speech: Access, Speech to Text: Access, Voices: Read, everything else: No Access. Set a monthly credit limit on the key too.",
  "settings.api.elevenLabsLink": "Create a key in ElevenLabs",
} as const;

export const settingsHe: Partial<Record<keyof typeof settingsEn, string>> = {
  "settings.telemetry.title": "ספירת שימוש אנונימית",
  "settings.telemetry.desc": "כבוי כברירת מחדל — ורק אם תבחרו להפעיל. Employee001 שולח ספירות אנונימיות בלבד, בלי שמות, טקסט, כתובות אימייל, שרתים או נתיבים.",
  "settings.telemetry.toggle": "שיתוף ספירת שימוש אנונימית",
  "settings.telemetry.on": "פעיל",
  "settings.telemetry.off": "כבוי",
  "settings.telemetry.preview": "מה נשלח",
  "settings.telemetry.loading": "טוענים תצוגה מקדימה…",
  "settings.telemetry.failed": "לא הצלחנו לעדכן את ההגדרה. נסו שוב.",
  "settings.api.elevenLabsHint": "אופציונלי, בשביל קול. צרו מפתח מוגבל: Text to Speech: Access, Speech to Text: Access, Voices: Read, וכל השאר: No Access. כדאי גם להגדיר למפתח מגבלת קרדיטים חודשית.",
  "settings.api.elevenLabsLink": "יצירת מפתח ב-ElevenLabs",
};
