// Typed UI catalogs. Components never read these directly — they call `t`
// with the active locale, usually via the bound helper from `useT()`.

export const LOCALES = ["en", "he"] as const;
export type Locale = (typeof LOCALES)[number];

export function isLocale(value: string | null): value is Locale {
  return value === "en" || value === "he";
}

const en = {
  "nav.section.work": "Work",
  "nav.section.twins": "Twins",
  "nav.section.operations": "Operations",
  "nav.section.control": "Control",
  "nav.section.labs": "Labs",
  "nav.approvals": "Approvals",
  "nav.tasks": "Tasks",
  "nav.teamMeeting": "Team Meeting",
  "nav.chat": "Chat",
  "nav.hire": "Hire",
  "nav.twins": "Twins",
  "nav.cockpit": "Cockpit",
  "nav.schedules": "Schedules",
  "nav.activityLog": "Activity log",
  "nav.spend": "Spend",
  "nav.tools": "Tools & MCP",
  "nav.handover": "Handover",
  "nav.settings": "Settings",
  "nav.pendingBadge": "{label} ({count} pending)",
  "autonomy.label": "Autonomy",
  "autonomy.armed": "Autonomy armed",
  "autonomy.off": "Autonomy off",
  "autonomy.titleArmed": "Autonomy armed — click to disarm",
  "autonomy.titleOff": "Autonomy off — click to arm",
  "settings.language": "Language",
} as const;

export type MessageKey = keyof typeof en;

const he: Record<MessageKey, string> = {
  "nav.section.work": "עבודה",
  "nav.section.twins": "תאומים",
  "nav.section.operations": "תפעול",
  "nav.section.control": "בקרה",
  "nav.section.labs": "מעבדה",
  "nav.approvals": "אישורים",
  "nav.tasks": "משימות",
  "nav.teamMeeting": "ישיבת צוות",
  "nav.chat": "צ'אט",
  "nav.hire": "גיוס",
  "nav.twins": "תאומים",
  "nav.cockpit": "קוקפיט",
  "nav.schedules": "תזמונים",
  "nav.activityLog": "יומן פעילות",
  "nav.spend": "הוצאות",
  "nav.tools": "כלים ו-MCP",
  "nav.handover": "חפיפה",
  "nav.settings": "הגדרות",
  "nav.pendingBadge": "{label} ({count} ממתינים)",
  "autonomy.label": "אוטונומיה",
  "autonomy.armed": "אוטונומיה פעילה",
  "autonomy.off": "אוטונומיה כבויה",
  "autonomy.titleArmed": "אוטונומיה פעילה — לחצו כדי לכבות",
  "autonomy.titleOff": "אוטונומיה כבויה — לחצו כדי להפעיל",
  "settings.language": "שפה",
};

export const messages: Record<Locale, Record<MessageKey, string>> = { en, he };

export type MessageVars = Record<string, string | number>;

/** Resolve one catalog string. `useT()` binds the locale so UI code calls `t(key)`. */
export function t(locale: Locale, key: MessageKey, vars?: MessageVars): string {
  const text: string = messages[locale][key];
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = vars[name];
    return value === undefined ? match : String(value);
  });
}
