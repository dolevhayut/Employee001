// i18n catalog for Chat (/flow) and Team Meeting (/council). messages.ts
// merges every area into the global en/he catalogs; keys must be unique
// across all areas (prefix them with "chat." or "meeting.").

export const chatMeetingEn = {} as const;

export const chatMeetingHe: Record<keyof typeof chatMeetingEn, string> = {};
