// Follow-up suggestions generator. After the twin finishes its main answer,
// we fire a tiny Haiku call to produce three short next-question prompts.
// Separated from the main runSingleTwin call so the suggestion latency
// doesn't block the streamed answer — the SSE route emits them as a
// trailing `followup_suggestions` event right before `done`.

import "server-only";
import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-haiku-4-5";
const MAX_TOKENS = 200;

/** Strict JSON shape we ask the model for. */
type SuggestionsShape = { suggestions: string[] };

let client: Anthropic | null = null;
function getClient(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}

export type FollowupContext = {
  /** The CEO's last message to the twin. */
  question: string;
  /** The twin's reply text (plain text after markdown stripping is fine — the
   *  model will infer intent either way). */
  answer: string;
  /** Twin's display name and role — helps shape suggestions toward the twin's
   *  domain rather than generic small-talk. */
  employeeName: string;
  employeeRole: string;
};

/**
 * Produce up to 3 short follow-up prompts (≤ 70 chars each) the CEO is
 * likely to want to send next. Suggestions are written in the same language
 * as the twin's answer (Hebrew if the answer is Hebrew, English otherwise),
 * phrased as if the CEO were typing them.
 *
 * Returns `[]` on any failure — caller should treat empty as "no chips to show".
 */
export async function generateFollowups(
  ctx: FollowupContext,
): Promise<string[]> {
  const c = getClient();
  if (!c) return [];

  const prompt = `You are helping a CEO continue a conversation with their AI twin "${ctx.employeeName}" (role: ${ctx.employeeRole}).

The CEO just asked:
"""${ctx.question.slice(0, 400)}"""

The twin replied:
"""${ctx.answer.slice(0, 1200)}"""

Produce exactly 3 short follow-up prompts the CEO is most likely to want to send next. Each one must:
- Read as if the CEO is typing it (first person from the CEO's side, e.g. "What if we...", "Show me...", "How would you handle...")
- Be ≤ 70 characters
- Be a NATURAL continuation of this specific exchange — not generic
- Be in the SAME LANGUAGE as the twin's reply (Hebrew if reply is Hebrew, English if English, etc.)
- Be distinct from each other (different angles, not three rewordings)

Respond with ONLY a JSON object of shape {"suggestions": ["...", "...", "..."]}. No prose, no markdown fences.`;

  try {
    const res = await c.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      messages: [{ role: "user", content: prompt }],
    });

    const text = res.content
      .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();

    // Tolerate a stray markdown fence even though we asked for raw JSON.
    const stripped = text
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    const parsed = JSON.parse(stripped) as Partial<SuggestionsShape>;
    if (!Array.isArray(parsed.suggestions)) return [];

    return parsed.suggestions
      .filter((s): s is string => typeof s === "string")
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && s.length <= 100)
      .slice(0, 3);
  } catch {
    // Network blip, malformed JSON, model offline — silently degrade.
    return [];
  }
}
