// i18n catalog for the work pages. messages.ts merges every area into the global
// en/he catalogs; keys must be unique across all areas (prefix them).

export const workEn = {} as const;

export const workHe: Record<keyof typeof workEn, string> = {};
