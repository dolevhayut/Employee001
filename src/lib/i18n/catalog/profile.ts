// i18n catalog for the twin profile page. messages.ts merges every area into
// the global en/he catalogs; keys must be unique across all areas (prefix
// them with "profile.").

export const profileEn = {} as const;

export const profileHe: Record<keyof typeof profileEn, string> = {};
