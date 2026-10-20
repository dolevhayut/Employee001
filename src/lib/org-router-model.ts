import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { TWIN_MODEL_HAIKU } from "@/lib/sdk-defaults";
import { directAnthropicAllowed } from "@/lib/model-provider";
import type { RouteCandidate, RoutePick } from "@/lib/org-router";

// Fallback for the organization router: when the keyword scorer can't tell
// (a Hebrew question over English profiles, or a vague one), one short Haiku
// call picks the twins by role. Returns null on any failure so the caller
// keeps the keyword result.

let client: Anthropic | null = null;
function getClient(): Anthropic | null {
  if (!directAnthropicAllowed() || !process.env.ANTHROPIC_API_KEY) return null;
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}

export async function routeWithModel(question: string, twins: RouteCandidate[], max = 3): Promise<RoutePick[] | null> {
  const c = getClient();
  if (!c || twins.length === 0) return null;

  const roster = twins
    .map((t) => `- ${t.id}: ${t.name}, ${t.role}. ${(t.text ?? "").replace(/\s+/g, " ").slice(0, 280)}`)
    .join("\n");
  const prompt = `A CEO asked their company a question. Pick the 1 to ${max} team members best placed to answer it, best first. Ask more than one only when the question really spans their areas.

Team:
${roster}

Question (any language):
"""${question.slice(0, 600)}"""

Respond with ONLY JSON: {"picks":[{"id":"<id>","why":"<2-4 English words>"}]}`;

  try {
    const res = await c.messages.create({
      model: TWIN_MODEL_HAIKU,
      max_tokens: 200,
      messages: [{ role: "user", content: prompt }],
    });
    const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    const json = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as { picks?: { id?: string; why?: string }[] };
    const ids = new Set(twins.map((t) => t.id));
    const picks = (json.picks ?? [])
      .filter((p): p is { id: string; why?: string } => typeof p.id === "string" && ids.has(p.id))
      .slice(0, max)
      .map((p, i) => ({ id: p.id, score: max - i, matched: p.why ? [p.why] : [], named: false }));
    return picks.length ? picks : null;
  } catch {
    return null;
  }
}
