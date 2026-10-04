import fs from "fs";
import { dataDir } from "@/lib/app-home";
import path from "path";
import { getComposio, composioUserIdFor, isComposioConfigured, readState } from "@/lib/composio-client";
import { loadEmployeesFromDisk } from "@/lib/employees-disk";
import { ingestSlackMessage, mappedTwinForMessage, normalizeSlackMessage, shouldIgnoreSlackMessage } from "@/lib/slack-intake";
import { ensureSlackTrigger, slackTriggerFor } from "@/lib/slack-intake-trigger";
import { emailPollIntervalMs } from "@/lib/email-intake-trigger";

const FILE = () => dataDir("slack-poll.json");
type State = Record<string, { lastPollAt: string; lastError?: string }>;
const load = (): State => { try { return JSON.parse(fs.readFileSync(FILE(), "utf8")) as State; } catch { return {}; } };
const save = (s: State) => { const file = FILE(); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(s, null, 2) + "\n"); };

/** Reconciliation only; all deliveries converge on channel:ts queue dedupe. */
export async function pollSlackMessages(): Promise<void> {
  if (!isComposioConfigured()) return;
  const state = load(); const now = Date.now(); const employees = await loadEmployeesFromDisk();
  const mappings = await Promise.all(employees.map(async (e) => { const slack = (await readState(e.id)).connections.slack; return { employeeId: e.id, slackUserId: slack?.slackUserId, workspaceId: slack?.slackWorkspaceId, active: slack?.status === "ACTIVE" }; }));
  for (const map of mappings.filter((m) => m.active && m.slackUserId)) {
    let armed = Boolean(slackTriggerFor(map.employeeId));
    if (!armed && process.env.COMPOSIO_WEBHOOK_SECRET && (process.env.APP_URL || process.env.EMPLOYEE001_PUBLIC_URL)) armed = (await ensureSlackTrigger(map.employeeId)).armed;
    if (state[map.employeeId]?.lastPollAt && now - Date.parse(state[map.employeeId].lastPollAt) < emailPollIntervalMs(armed)) continue;
    state[map.employeeId] = { lastPollAt: new Date(now).toISOString() };
    try {
      const result = await getComposio().tools.execute("SLACK_SEARCH_MESSAGES", { userId: composioUserIdFor(map.employeeId), arguments: { query: `<@${map.slackUserId}>`, count: 25 } }) as { data?: unknown; successful?: boolean; error?: unknown };
      if (result.successful === false) throw new Error(String(result.error ?? "Slack fetch failed"));
      const rows = Array.isArray(result.data) ? result.data : (result.data as { messages?: unknown[] } | undefined)?.messages ?? [];
      for (const row of rows) { if (!row || typeof row !== "object") continue; const message = normalizeSlackMessage(row as Record<string, unknown>); if (!message) continue; const target = mappedTwinForMessage(message, mappings); if (target !== map.employeeId || shouldIgnoreSlackMessage(message, map.slackUserId)) continue; ingestSlackMessage(map.employeeId, message); }
    } catch (error) { state[map.employeeId].lastError = (error instanceof Error ? error.message : String(error)).slice(0, 200); }
  }
  save(state);
}
