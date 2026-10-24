// The voice fast lane on Ask. A spoken question wants a spoken answer within a
// couple of seconds, and most of the wait before the first word is setup, not
// thinking: connecting the twin's external tools (Composio, the org's custom
// MCP servers) costs about two seconds on every turn. So a voice question
// skips them, and thinks briefly, unless it plainly needs a connected system
// or asks for an action: then the full run goes ahead (tools, full reasoning)
// and the twin says it's looking it up.
//
// Pure, shared by the server (which tools to load) and the page (what to say
// while the twin works). It only ever removes tools, never adds any, and when
// in doubt it keeps them: a slow answer beats one made up from memory.

/** Connected systems a spoken question may name (English and Hebrew). */
const SYSTEMS: [RegExp, string][] = [
  [/\bslack\b|סלאק/i, "Slack"],
  [/\bg-?mail\b|ג['׳]ימייל/i, "Gmail"],
  [/\boutlook\b|אאוטלוק|אווטלוק/i, "Outlook"],
  [/\bms teams\b|\bmicrosoft teams\b|\bin teams\b|\bon teams\b|טימס/i, "Teams"],
  [/\blinear\b(?! (regression|model|growth|scale))|ליניאר/i, "Linear"],
  [/\bjira\b|ג['׳]ירה/i, "Jira"],
  [/\bgit-?hub\b|גיטהאב/i, "GitHub"],
  [/\bnotion\b|נושן/i, "Notion"],
  [/\bconfluence\b|קונפלואנס/i, "Confluence"],
  [/\b(google )?(drive|docs|sheets)\b|\bshare-?point\b|\bdropbox\b|דרייב|שרפוינט|דרופבוקס/i, "Drive"],
  [/\bhub-?spot\b|\bsalesforce\b|\bcrm\b|הבספוט|סיילספורס/i, "the CRM"],
  [/\bzendesk\b|\bintercom\b|זנדסק|אינטרקום/i, "support"],
  [/\b(asana|trello|monday|click-?up|airtable)\b|אסאנה|טרלו|מאנדיי|מנדיי/i, "your task board"],
  [/\b(stripe|shopify)\b|סטרייפ|שופיפיי/i, "billing"],
  [/\bwhats-?app\b|וואטסאפ|ווטסאפ/i, "WhatsApp"],
  [/\bzoom\b|זום/i, "Zoom"],
  [/\bcompany-?sim\b/i, "CompanySim"],
  [
    /\b(calendar|agenda|schedule for|my schedule)\b|\b(my|next|any|a) meetings?\b|\bmeetings? (today|tomorrow|this week|on \w+)\b|יומן|לוח זמנים|פגישה|פגישות/i,
    "the calendar",
  ],
  [/\b(e-?mails?|inbox|unread|dms?|direct messages?|my messages)\b|\bmail\b|מייל|מיילים|דואר|(^|\s)תיבת|הודעות/i, "email"],
  [/\b(tickets?|open issues|pull requests?|PRs?|deals?|pipeline|invoices?)\b|טיקט|כרטיסים פתוחים|באגים פתוחים|דילים|חשבוניות/i, "your systems"],
];

/** Asking the twin to do something, not to know something. Hebrew verbs may
 *  carry a ו/ש/ל prefix, and "can you" questions use the infinitive. */
const ACTIONS = new RegExp(
  [
    String.raw`\b(send|post|reply to|forward|re-?schedule|schedule (a|an|the|my)|book|create|open (a|an) (ticket|issue)|assign|update (the|my|a)|remind|tell (?!me\b)|message|ping|cancel|add (a|an|the)|invite|draft|delete|move (the|my)|look (it )?up in|check (my|in))\b`,
    String.raw`(^|\s)[וש]?(תשלח|שלח|שלחי|תשלחי|לשלוח|תענה|לענות|תזמן|לתזמן|תקבע|קבעי|לקבוע|תיצור|ליצור|צור לי|תפתח|לפתוח|תעדכן|לעדכן|תבטל|לבטל|תזכיר|להזכיר|תגיד ל(?!י)|תודיע|להודיע|תבדוק ב|בדוק ב|לבדוק ב)`,
  ].join("|"),
  "i",
);

export type VoiceLane = { fast: true } | { fast: false; system: string };

/** The person's own words: what the page sent, without its style note. */
export function spokenWords(question: string): string {
  return question.split("\n\n(")[0];
}

/** Whether a spoken question can be answered from what the twin already
 *  knows (profile, memory, company brain) or needs its connected tools.
 *  `systems` adds names the org connected itself (its custom MCP servers). */
export function voiceLane(question: string, systems: string[] = []): VoiceLane {
  const words = spokenWords(question);
  for (const [re, system] of SYSTEMS) if (re.test(words)) return { fast: false, system };
  const lower = words.toLowerCase();
  for (const name of systems) {
    const n = name.trim().toLowerCase();
    if (n.length >= 3 && lower.includes(n)) return { fast: false, system: name.trim() };
  }
  if (ACTIONS.test(words)) return { fast: false, system: "your systems" };
  return { fast: true };
}

/** A follow-up ("and which ones are still open?") stays in the lane of the
 *  question before it. */
export function voiceLaneInContext(question: string, previousQuestion: string | undefined, systems: string[] = []): VoiceLane {
  const lane = voiceLane(question, systems);
  if (!lane.fast || !previousQuestion) return lane;
  return voiceLane(previousQuestion, systems);
}

/** Appended to a spoken question: short, speakable, still cited. */
export const VOICE_ANSWER_STYLE =
  "This answer will be spoken aloud. Answer in the language of the question, in two to four short " +
  "spoken sentences (under 60 words), as plain text: no markdown, lists, file names, slugs, IDs or URLs. " +
  "Be concrete: name the people, projects or numbers involved. After each fact, cite where it came from as " +
  "[[source]] with no spaces, before the period: [[profile]], [[brain]], [[web]] or a connected system's " +
  "name in lowercase. Answer from what's already in your context (profile, memory, the company brain " +
  "notes above) and search only when the answer isn't there. If you'd need a connected system you " +
  "don't have here, say so in one sentence instead of guessing.";

export const isHebrew = (s: string) => /[֐-׿]/.test(s);

/** What the twin says the moment a spoken question is sent, while it works.
 *  Gender-neutral in Hebrew (the twin's gender isn't known). */
export function ackPhrase(question: string, lane: VoiceLane): string {
  const hebrew = isHebrew(question);
  if (lane.fast) return hebrew ? "רק רגע." : "Let me check.";
  return hebrew ? "רק רגע, צריך לבדוק את זה במערכות." : "Let me look that up. It'll take a moment.";
}

/** Every acknowledgment, to synthesize ahead of time for a voice (the
 *  common ones first: they're made one at a time). */
export const ACK_PHRASES = [
  ackPhrase("", { fast: true }),
  ackPhrase("א", { fast: true }),
  ackPhrase("", { fast: false, system: "" }),
  ackPhrase("א", { fast: false, system: "" }),
];
