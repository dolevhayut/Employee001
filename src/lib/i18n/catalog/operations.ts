// i18n catalog for the operator pages. messages.ts merges every area into the global
// en/he catalogs; keys must be unique across all areas (prefix them).

export const operationsEn = {} as const;

export const operationsHe: Record<keyof typeof operationsEn, string> = {};
