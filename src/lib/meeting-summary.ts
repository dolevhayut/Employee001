import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { directAnthropicAllowed } from "@/lib/model-provider";
import { TWIN_MODEL_PRIMARY } from "@/lib/sdk-defaults";
import type { MeetingTurn } from "@/lib/meeting-store";
import { normalizeStances, type MeetingStance } from "@/lib/meeting-stances";

// "Summarize & decide": turns the latest discussion in a team meeting into a
// decision the CEO can act on: what was decided, who does what next (each
// action assignable to that twin as a task), and what is still open.

export type MeetingAction = {
  employeeId: string;
  action: string;
  due?: string;
  /** Set when "Send to Roomate" started filing this action (ms). */
  sentAt?: number;
  /** The Roomate task id the owner's twin reported, when it named one. */
  taskId?: string;
};
export type MeetingDecision = {
  decision: string;
  actions: MeetingAction[];
  open: string[];
  /** Who accepted or objected, and the turn that says so. Absent on meetings summarized before this existed. */
  stances?: MeetingStance[];
};

let client: Anthropic | null = null;
function getClient(): Anthropic | null {
  if (!directAnthropicAllowed() || !process.env.ANTHROPIC_API_KEY) return null;
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}

/** The turns since the CEO's last question (the discussion being decided). */
export function lastDiscussion(transcript: MeetingTurn[]): MeetingTurn[] {
  return transcript.slice(lastDiscussionStart(transcript));
}

/** Index in the transcript where lastDiscussion() begins. */
export function lastDiscussionStart(transcript: MeetingTurn[]): number {
  let start = 0;
  transcript.forEach((t, i) => {
    if (t.kind === "ceo") start = i;
  });
  return start;
}

export async function summarizeMeeting(
  turns: MeetingTurn[],
  people: { id: string; name: string; role: string }[],
  /** Index of turns[0] in the full transcript, so stances point at real turns. */
  turnOffset = 0,
): Promise<MeetingDecision | null> {
  const c = getClient();
  if (!c || turns.length < 2) return null;
  const text = turns
    .map((t, i) => (t.kind === "ceo" ? `[${turnOffset + i}] CEO: ${t.text}` : `[${turnOffset + i}] ${t.employeeName}: ${t.text}`))
    .join("\n\n")
    .slice(-14_000);
  const hebrew = turns.some((t) => t.kind === "ceo" && /[֐-׿]/.test(t.text));
  const roster = people.map((p) => `- ${p.id}: ${p.name}, ${p.role}`).join("\n");

  const res = await c.messages.create({
    model: TWIN_MODEL_PRIMARY,
    max_tokens: 1600,
    system: `You close a team meeting for the CEO. From the discussion, write:
- "decision": what the team converged on, in at most two short sentences (or the best recommendation if they didn't fully agree).
- "actions": 2 to 5 concrete next steps, each owned by one team member (use their id from the roster), phrased as a short task they can start now: an imperative of at most 15 words, like a ticket title; add "due" only if a date or timeframe was mentioned (a few words).
- "open": questions still unresolved (0 to 3).
- "stances": for each team member who clearly accepted or objected to the decision, {"employeeId", "stance": "accept" or "object", "turn"}, where turn is the number in [brackets] of THEIR OWN message that says so. Leave out anyone who never took a position; never guess.
Write in ${hebrew ? "Hebrew" : "English"}. Respond with ONLY JSON: {"decision": "...", "actions": [{"employeeId": "...", "action": "...", "due": "..."}], "open": ["..."], "stances": [{"employeeId": "...", "stance": "accept", "turn": 3}]}`,
    messages: [{ role: "user", content: `Team:\n${roster}\n\nDiscussion:\n${text}` }],
  }).catch((err: unknown) => {
    console.warn(`[meeting-summary] request failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  });
  if (!res) return null;
  const raw = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  try {
    const json = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as Partial<MeetingDecision>;
    const ids = new Set(people.map((p) => p.id));
    return {
      decision: String(json.decision ?? "").trim(),
      actions: (json.actions ?? []).filter((a): a is MeetingAction => Boolean(a && ids.has(a.employeeId) && a.action)).slice(0, 6),
      open: (json.open ?? []).map(String).slice(0, 3),
      stances: normalizeStances(
        json.stances,
        [...Array.from({ length: turnOffset }, () => ({ kind: "ceo" as const })), ...turns],
      ),
    };
  } catch {
    console.warn(`[meeting-summary] unparseable reply (${res.stop_reason}): ${raw.slice(0, 300)}`);
    return null;
  }
}
