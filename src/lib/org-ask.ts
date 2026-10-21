import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { loadEmployeesFromDisk } from "@/lib/employees-disk";
import { getHiredEmployees } from "@/lib/hired-agents";
import { hasEmployeeFiles } from "@/lib/employees-files";
import { dataDir } from "@/lib/app-home";
import { readTwinText, routeQuestion, type RoutePick } from "@/lib/org-router";
import { routeWithModel } from "@/lib/org-router-model";
import { runSingleTwin } from "@/lib/council-runner";
import { directAnthropicAllowed } from "@/lib/model-provider";
import { TWIN_MODEL_PRIMARY } from "@/lib/sdk-defaults";
import type { EmployeeWithTwin } from "@/lib/employees";

// "Ask the company": the organization answers with ONE voice. Unlike a team
// meeting (twins talking, in turn, each in their own voice), the routed twins
// are read-only sources here: they write short factual briefs in parallel,
// and one model call turns the briefs into a single answer that cites each
// claim back to the twin it came from ([[twin-id]] markers).

export async function readyTwins(): Promise<EmployeeWithTwin[]> {
  const fromDisk = await loadEmployeesFromDisk();
  const roster = [...fromDisk, ...getHiredEmployees().filter((h) => !fromDisk.some((e) => e.id === h.id))];
  return roster.filter((e) => e.twinStatus === "ready" && hasEmployeeFiles(e.id));
}

/** Which twins should answer: keywords first, Haiku when they can't decide. */
export async function pickTwins(question: string, twins: EmployeeWithTwin[]): Promise<{ picks: RoutePick[]; by: "keywords" | "model" }> {
  const candidates = twins.map((e) => ({ id: e.id, firstName: e.firstName, name: e.name, role: e.role, text: readTwinText(dataDir("employees", e.id)) }));
  const picks = routeQuestion(question, candidates);
  if (picks[0]?.score < 3 && !picks[0]?.named) {
    const fromModel = await routeWithModel(question, candidates);
    if (fromModel) return { picks: fromModel, by: "model" };
  }
  return { picks, by: "keywords" };
}

const NOTHING = "NOTHING";

function briefPrompt(question: string): string {
  return `The CEO asked the whole company:
"""${question.slice(0, 1200)}"""

You are one of the sources for the company's answer, not the one answering the CEO. Write a short factual brief from your own area only:
- 3 to 6 bullets, each one concrete fact (names, numbers, dates, record ids, file names). Look things up if you need to.
- No greeting, no sign-off, no opinions about colleagues, don't tag or address anyone, no questions back.
- If nothing in your area is relevant, reply with exactly: ${NOTHING}
Write the brief in English.`;
}

export type SourceEvent =
  | { type: "source_start"; id: string }
  | { type: "source_tool"; id: string; tool: string; input: unknown }
  | { type: "source_done"; id: string; brief: string; empty: boolean }
  | { type: "source_error"; id: string };

/** Run one twin as a read-only source and return its brief ("" when it had nothing). */
export async function briefFrom(
  twin: EmployeeWithTwin,
  question: string,
  emit: (e: SourceEvent) => void,
  abort: AbortController,
): Promise<string> {
  emit({ type: "source_start", id: twin.id });
  try {
    const text = await runSingleTwin(
      twin,
      briefPrompt(question),
      (evt) => {
        if (evt.type === "tool_use") emit({ type: "source_tool", id: twin.id, tool: evt.tool, input: evt.input });
      },
      [],
      { readOnly: true, maxBudgetUsd: 0.6, abortController: abort, runId: `org_${twin.id}_${Date.now()}` },
    );
    const brief = text.trim();
    const empty = !brief || brief.toUpperCase().startsWith(NOTHING);
    emit({ type: "source_done", id: twin.id, brief: empty ? "" : brief, empty });
    return empty ? "" : brief;
  } catch {
    emit({ type: "source_error", id: twin.id });
    return "";
  }
}

let client: Anthropic | null = null;
function getClient(): Anthropic | null {
  if (!directAnthropicAllowed() || !process.env.ANTHROPIC_API_KEY) return null;
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}

/** Turn the briefs into the company's single answer, streamed. */
export async function synthesize(
  question: string,
  sources: { twin: EmployeeWithTwin; brief: string }[],
  onDelta: (delta: string) => void,
): Promise<void> {
  const usable = sources.filter((s) => s.brief);
  const hebrew = /[֐-׿]/.test(question);
  const c = getClient();
  if (!c || usable.length === 0) {
    // No direct model access (other provider) or nothing found: show the briefs as they are.
    onDelta(
      usable.length
        ? usable.map((s) => `${s.brief.replace(/\n+/g, " ")} [[${s.twin.id}]]`).join("\n\n")
        : hebrew
          ? "אף אחד בצוות לא מצא מידע על זה."
          : "No one on the team had anything on this.",
    );
    return;
  }

  const briefs = usable.map((s) => `<brief id="${s.twin.id}" name="${s.twin.firstName}" role="${s.twin.role}">\n${s.brief}\n</brief>`).join("\n\n");
  const stream = c.messages.stream({
    model: TWIN_MODEL_PRIMARY,
    max_tokens: 1200,
    system: `You write the company's answer to its CEO from briefs written by team members.

Rules:
- One answer, in ${hebrew ? "Hebrew" : "English"}. Speak as the company ("we"), never as one person. No greeting, no sign-off.
- Lead with the direct answer in one or two sentences, then the supporting facts. At most 160 words. Plain sentences or "- " bullets; no headings, no bold, no tables.
- After every sentence or bullet that states a fact, add the ids of the briefs it came from, like [[daniel-azoulay]] or [[noa-friedman, daniel-azoulay]], right before the period or at the end of the bullet.
- Use only facts in the briefs. If briefs disagree, say so and cite both. If something the CEO asked is not covered, say what is missing.`,
    messages: [{ role: "user", content: `CEO's question:\n"""${question.slice(0, 1200)}"""\n\nBriefs:\n${briefs}` }],
  });
  for await (const ev of stream) {
    if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") onDelta(ev.delta.text);
  }
}
