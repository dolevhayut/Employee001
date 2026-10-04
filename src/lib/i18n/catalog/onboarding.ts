// i18n catalog for the onboarding pages. messages.ts merges every area into
// the global en/he catalogs; keys must be unique across all areas (prefix them).

export const onboardingEn = {} as const;

export const onboardingHe: Record<keyof typeof onboardingEn, string> = {};
