import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { query, type CanUseTool } from "@anthropic-ai/claude-agent-sdk";
import { loadEmployeesFromDisk } from "@/lib/employees-disk";
import { getHiredEmployees } from "@/lib/hired-agents";
import { hasEmployeeFiles } from "@/lib/employees-files";
import { dataDir } from "@/lib/app-home";
import { readTwinText, routeQuestion, type RoutePick } from "@/lib/org-router";
import { routeWithModel } from "@/lib/org-router-model";
import { runSingleTwin } from "@/lib/council-runner";
import { directAnthropicAllowed, modelErrorMessage } from "@/lib/model-provider";
import { relayTurn } from "@/lib/relay/model";
import { TWIN_HARD_DISALLOWED, TWIN_MODEL_PRIMARY, buildBaseOptions, buildTwinHooks } from "@/lib/sdk-defaults";
import { listCustomMcp, loadOrgCustomMcpServers } from "@/lib/custom-mcp";
import { selectOrgBrainNodesForRun } from "@/lib/org-brain";
import { classifyTool } from "@/lib/tool-policy";
import { loadReadAllowlist } from "@/lib/read-allowlist";
import { displayRole, type EmployeeWithTwin } from "@/lib/employees";

// "Ask the company": the organization answers with ONE voice. Unlike a team
// meeting (twins talking, in turn, each in their own voice), everything here
// is a read-only source, gathered in parallel:
//   - the company brain (the org-brain files managed in Settings),
//   - the company's connected systems (org MCP servers: CRM, ERP, CompanySim…),
//   - the routed twins, each writing a short factual brief.
// One model call then writes a single answer that cites each claim back to
// its source ([[source-id]] markers).

/** Source ids for the non-twin sources; twin sources use the twin id. */
export const ORG_BRAIN_SOURCE = "org-brain";
export const SYSTEMS_SOURCE = "systems";

export async function readyTwins(): Promise<EmployeeWithTwin[]> {
  const fromDisk = await loadEmployeesFromDisk();
  const roster = [...fromDisk, ...getHiredEmployees().filter((h) => !fromDisk.some((e) => e.id === h.id))];
  return roster.filter((e) => e.twinStatus === "ready" && hasEmployeeFiles(e.id));
}

/** Which twins should answer: keywords first, Haiku when they can't decide. */
export async function pickTwins(question: string, twins: EmployeeWithTwin[]): Promise<{ picks: RoutePick[]; by: "keywords" | "model" }> {
  const candidates = twins.map((e) => ({ id: e.id, firstName: e.firstName, name: e.name, role: displayRole(e), text: readTwinText(dataDir("employees", e.id)) }));
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
  | { type: "source_start"; id: string; name?: string; title?: string }
  | { type: "source_tool"; id: string; tool: string; input: unknown }
  | { type: "source_done"; id: string; brief: string; empty: boolean }
  | { type: "source_error"; id: string; message?: string };

/** Run one twin as a read-only source and return its brief (null when it had nothing). */
export async function briefFrom(
  twin: EmployeeWithTwin,
  question: string,
  emit: (e: SourceEvent) => void,
  abort: AbortController,
): Promise<Brief | null> {
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
    // A former employee's brief is what they knew when they left: say so.
    return empty ? null : { id: twin.id, name: twin.firstName, title: twin.lifecycle === "retired" ? `${displayRole(twin)}, has left` : twin.role, brief };
  } catch (err) {
    emit({ type: "source_error", id: twin.id, message: modelErrorMessage(err instanceof Error ? err.message : String(err)) });
    return null;
  }
}

export type Brief = { id: string; name: string; title: string; brief: string };

/** The company brain: org-brain nodes that match the question. Instant, no model call. */
export function briefFromOrgBrain(question: string, emit: (e: SourceEvent) => void): Brief | null {
  const hits = selectOrgBrainNodesForRun(question, 5);
  if (hits.length === 0) return null;
  const title = `${hits.length} document${hits.length === 1 ? "" : "s"}`;
  emit({ type: "source_start", id: ORG_BRAIN_SOURCE, name: "Company brain", title });
  // The card shows one clean line per document; the answer writer gets the text too.
  const shown = hits.map(({ node }) => `- ${node.label}: ${node.description}`).join("\n");
  const brief = hits
    .map(({ node }) => `- ${node.label} (${node.type}): ${node.description}${node.body ? ` ${node.body.replace(/^#+\s*/gm, "").replace(/\s+/g, " ").slice(0, 600)}` : ""}`)
    .join("\n");
  emit({ type: "source_done", id: ORG_BRAIN_SOURCE, brief: shown, empty: false });
  return { id: ORG_BRAIN_SOURCE, name: "Company brain", title, brief };
}

/**
 * The company's connected systems: an agent with no persona that sees only
 * the org MCP servers (CRM, ERP, CompanySim…) and may only call what the tool
 * policy classifies as a read. Every call is audited like a twin's.
 */
export async function briefFromSystems(question: string, emit: (e: SourceEvent) => void, abort: AbortController): Promise<Brief | null> {
  const [mcpServers, listed] = await Promise.all([loadOrgCustomMcpServers().catch(() => ({})), listCustomMcp().catch(() => [])]);
  if (Object.keys(mcpServers).length === 0) return null;
  const title = listed.filter((s) => s.enabled).map((s) => s.name).join(", ");
  emit({ type: "source_start", id: SYSTEMS_SOURCE, name: "Company systems", title });

  const runId = `org_systems_${Date.now()}`;
  const readAllowlist = loadReadAllowlist();
  const canUseTool: CanUseTool = async (toolName, input) => {
    const readable = toolName === "ToolSearch" || (toolName.startsWith("mcp__") && classifyTool(toolName, input as Record<string, unknown>, undefined, { readAllowlist }).kind === "allow");
    return readable
      ? { behavior: "allow", updatedInput: input }
      : { behavior: "deny", message: "Read-only lookup: only read calls to the company's connected systems are allowed." };
  };
  let brief = "";
  try {
    const stream = query({
      prompt: `The CEO asked the company:
"""${question.slice(0, 1200)}"""

Look it up in the company's connected systems (the MCP tools you have: CRM, ERP, project and customer records, and so on). Read only.
Then write a short factual brief: 3 to 6 bullets, each one concrete fact with names, numbers, dates and record ids. No greeting, no advice.
If the systems hold nothing relevant, reply with exactly: ${NOTHING}
Write the brief in English.`,
      options: {
        ...buildBaseOptions({ surface: "chat", abortController: abort, runId, employeeId: "org-systems" }),
        disallowedTools: [...TWIN_HARD_DISALLOWED, "Read", "Glob", "Grep", "Write", "Edit", "Bash", "WebFetch", "WebSearch", "Task", "TodoWrite", "AskUserQuestion"],
        systemPrompt: "You are the company's records desk. You answer only from the company's connected systems, through the MCP tools you have, and you never change anything.",
        mcpServers,
        allowedTools: [],
        maxTurns: 12,
        maxBudgetUsd: 0.6,
        permissionMode: "default",
        canUseTool,
        settingSources: [],
        hooks: buildTwinHooks({ runId, employeeId: "org-systems", employeeName: "Company systems", surface: "chat" }),
      },
    });
    for await (const m of stream) {
      if (m.type === "assistant") {
        for (const block of m.message.content) {
          if (block.type === "tool_use" && block.name !== "ToolSearch") emit({ type: "source_tool", id: SYSTEMS_SOURCE, tool: block.name, input: block.input });
        }
      } else if (m.type === "result" && m.subtype === "success") {
        brief = m.result.trim();
      }
    }
  } catch {
    emit({ type: "source_error", id: SYSTEMS_SOURCE });
    return null;
  }
  const empty = !brief || brief.toUpperCase().startsWith(NOTHING);
  emit({ type: "source_done", id: SYSTEMS_SOURCE, brief: empty ? "" : brief, empty });
  return empty ? null : { id: SYSTEMS_SOURCE, name: "Company systems", title, brief };
}

let client: Anthropic | null = null;
function getClient(): Anthropic | null {
  if (!directAnthropicAllowed() || !process.env.ANTHROPIC_API_KEY) return null;
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}

function synthesisSystem(hebrew: boolean): string {
  return `You write the company's answer to its CEO from briefs: the company brain (documents), the company's connected systems (records), and team members.

Rules:
- One answer, in ${hebrew ? "Hebrew" : "English"}. Speak as the company ("we"), never as one person. No greeting, no sign-off.
- Lead with the direct answer in one or two sentences, then the supporting facts. At most 160 words. Plain sentences or "- " bullets; no headings, no bold, no tables.
- After every sentence or bullet that states a fact, add the ids of the briefs it came from, like [[daniel-azoulay]] or [[systems, daniel-azoulay]], right before the period or at the end of the bullet.
- Prefer records and documents for hard numbers; use team members for context and status.
- Use only facts in the briefs. If briefs disagree, say so and cite both. If something the CEO asked is not covered, say what is missing.`;
}

/** Turn the briefs into the company's single answer, streamed. `failure` is
 *  why a source couldn't run (a bad key, Claude Code signed out): when no
 *  source had anything, that's the answer, not "no one knew". */
export async function synthesize(question: string, sources: (Brief | null)[], onDelta: (delta: string) => void, failure?: string | null): Promise<void> {
  const usable = sources.filter((s): s is Brief => Boolean(s?.brief));
  const hebrew = /[֐-׿]/.test(question);
  if (usable.length === 0) {
    onDelta(
      failure
        ? (hebrew ? `לא הצלחתי להגיע לתאומים: ${failure}` : `Couldn't reach the twins: ${failure}`)
        : hebrew
          ? "אף אחד בצוות לא מצא מידע על זה."
          : "No one on the team had anything on this.",
    );
    return;
  }

  const briefs = usable.map((s) => `<brief id="${s.id}" source="${s.name}" about="${s.title}">\n${s.brief}\n</brief>`).join("\n\n");
  const prompt = `CEO's question:\n"""${question.slice(0, 1200)}"""\n\nBriefs:\n${briefs}`;
  const c = getClient();
  if (!c) {
    // No direct API (a cloud provider, a local model or a Claude
    // subscription): write it through the Agent SDK on the configured
    // provider. If that fails before writing anything, show the briefs.
    let wrote = false;
    try {
      await relayTurn({ employeeId: "org-ask", model: TWIN_MODEL_PRIMARY, system: synthesisSystem(hebrew), prompt, onDelta: (d) => { wrote = true; onDelta(d); } });
    } catch {
      if (!wrote) onDelta(usable.map((s) => `${s.brief.replace(/\n+/g, " ")} [[${s.id}]]`).join("\n\n"));
    }
    return;
  }

  const stream = c.messages.stream({
    model: TWIN_MODEL_PRIMARY,
    max_tokens: 1200,
    system: synthesisSystem(hebrew),
    messages: [{ role: "user", content: prompt }],
  });
  for await (const ev of stream) {
    if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") onDelta(ev.delta.text);
  }
}
