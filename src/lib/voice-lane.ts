// The voice fast lane on Ask. A spoken question wants a spoken answer within a
// couple of seconds, and most of the wait before the first word is setup, not
// thinking: connecting the twin's external tools (Composio, the org's custom
// MCP servers) costs about two seconds on every turn. So a voice question
// skips them, and thinks briefly, unless it plainly needs a connected system:
// then the full run goes ahead and the twin says it's looking it up.
//
// Pure, shared by the server (which tools to load) and the page (what to say
// while the twin works). Only ever removes tools, never adds any.

/** Connected systems a spoken question may name (English and Hebrew). */
const SYSTEMS: [RegExp, string][] = [
  [/\bslack\b|סלאק/i, "Slack"],
  [/\bg-?mail\b|ג['׳]?ימייל/i, "Gmail"],
  [/\boutlook\b|אאוטלוק|אווטלוק/i, "Outlook"],
  [/\bteams\b|טימס/i, "Teams"],
  [/\blinear\b|ליניאר/i, "Linear"],
  [/\bjira\b|ג['׳]?ירה/i, "Jira"],
  [/\bgit-?hub\b|גיטהאב/i, "GitHub"],
  [/\bnotion\b|נושן/i, "Notion"],
  [/\bconfluence\b|קונפלואנס/i, "Confluence"],
  [/\b(google )?drive\b|\bshare-?point\b|דרייב|שרפוינט/i, "Drive"],
  [/\bhub-?spot\b|\bsalesforce\b|\bcrm\b|הבספוט|סיילספורס/i, "the CRM"],
  [/\bzendesk\b|\bintercom\b|זנדסק|אינטרקום/i, "support"],
  [/\bcompany-?sim\b/i, "CompanySim"],
  [/\bcalendar\b|\bmeetings? (today|tomorrow|this week)\b|יומן|פגישות (היום|מחר|השבוע)/i, "the calendar"],
  [/\b(e-?mails?|inbox|unread)\b|\bmail\b|מייל|מיילים|דואר|תיבת/i, "email"],
  [/\b(tickets?|issues?|pull requests?|PRs?|deals?|pipeline|invoices?)\b|טיקט|כרטיס|באגים פתוחים|דילים|חשבוניות/i, "your systems"],
];

/** Asking the twin to do something, not to know something. */
const ACTIONS =
  /\b(send|post|reply|forward|schedule|book|create (a|an|the)|open (a|an) (ticket|issue)|assign|update (the|my)|look (it )?up in|check (my|in))\b|(^|\s)(ת?שלח|שלחי|תענה|תזמן|ת?קבע|קבעי|צור|תיצור|תפתח|תעדכן|תבדוק ב|בדוק ב)/i;

export type VoiceLane = { fast: true } | { fast: false; system: string };

/** Whether a spoken question can be answered from what the twin already
 *  knows (profile, memory, company brain) or needs its connected tools. */
export function voiceLane(question: string): VoiceLane {
  for (const [re, system] of SYSTEMS) if (re.test(question)) return { fast: false, system };
  if (ACTIONS.test(question)) return { fast: false, system: "your systems" };
  return { fast: true };
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

/** What the twin says the moment a spoken question is sent, while it works.
 *  Gender-neutral in Hebrew (the twin's gender isn't known). */
export function ackPhrase(question: string, lane: VoiceLane): string {
  const hebrew = /[֐-׿]/.test(question);
  if (lane.fast) return hebrew ? "רק רגע." : "Let me check.";
  return hebrew ? "רק רגע, צריך לבדוק את זה במערכות." : "Let me look that up. It'll take a moment.";
}

/** Every acknowledgment, to synthesize ahead of time for a voice. */
export const ACK_PHRASES = [
  ackPhrase("", { fast: true }),
  ackPhrase("", { fast: false, system: "" }),
  ackPhrase("א", { fast: true }),
  ackPhrase("א", { fast: false, system: "" }),
];
