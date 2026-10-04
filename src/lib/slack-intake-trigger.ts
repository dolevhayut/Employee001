import fs from "fs";
import { dataDir } from "@/lib/app-home";
import path from "path";
import { composioUserIdFor, getComposio, readState } from "@/lib/composio-client";
import { publicWebhookUrl } from "@/lib/email-intake-trigger";

const FILE = () => dataDir("org", "slack-triggers.json");
const FALLBACK_TRIGGER_SLUG = "SLACK_NEW_MESSAGE";
type SlackTrigger = { triggerId: string; triggerSlug: string; connectedAccountId?: string; updatedAt: string };
type State = Record<string, SlackTrigger>;
const load = (): State => { try { return JSON.parse(fs.readFileSync(FILE(), "utf8")) as State; } catch { return {}; } };
const save = (state: State) => { const file = FILE(); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(state, null, 2) + "\n"); };
export const slackTriggerFor = (employeeId: string) => load()[employeeId];

type Client = { triggers: { listActive(query?: unknown): Promise<unknown>; listTypes(query?: unknown): Promise<unknown>; create(userId: string, slug: string, body?: unknown): Promise<unknown>; disable(id: string): Promise<unknown> } };
const rows = (value: unknown): Record<string, unknown>[] => { const v = Array.isArray(value) ? value : value && typeof value === "object" ? (value as { items?: unknown }).items : []; return Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === "object") : []; };
const field = (row: Record<string, unknown>, ...keys: string[]) => keys.map((k) => row[k]).find((v): v is string => typeof v === "string" && Boolean(v));
export function findSlackMessageTrigger(items: Record<string, unknown>[]): string | null {
  const candidate = items.map((item) => ({ slug: field(item, "slug", "name"), text: `${field(item, "slug", "name") ?? ""} ${field(item, "description") ?? ""}`.toUpperCase() })).find((x) => x.slug && /SLACK/.test(x.text) && /(NEW|MESSAGE|MENTION|DM|DIRECT)/.test(x.text) && !/(REACTION|DELETE|EDIT)/.test(x.text));
  return candidate?.slug ?? null;
}
export async function ensureSlackTrigger(employeeId: string): Promise<{ armed: boolean; reason?: string }> {
  if (!publicWebhookUrl(process.env, "/api/slack/composio")) return { armed: false, reason: "no public HTTPS APP_URL/EMPLOYEE001_PUBLIC_URL" };
  if (!process.env.COMPOSIO_WEBHOOK_SECRET) return { armed: false, reason: "COMPOSIO_WEBHOOK_SECRET is not set" };
  try {
    const connection = (await readState(employeeId)).connections.slack;
    if (connection?.status !== "ACTIVE") return { armed: false, reason: "Slack is not active" };
    const client = getComposio() as unknown as Client;
    const active = rows(await client.triggers.listActive({ connectedAccountIds: connection.connectedAccountId ? [connection.connectedAccountId] : undefined, showDisabled: true, limit: 200 }));
    const existing = active.find((row) => field(row, "connectedAccountId", "connected_account_id") === connection.connectedAccountId);
    const triggerId = field(existing ?? {}, "id", "triggerId");
    if (triggerId) { const state = load(); state[employeeId] = { triggerId, triggerSlug: field(existing!, "triggerName", "triggerSlug") ?? FALLBACK_TRIGGER_SLUG, connectedAccountId: connection.connectedAccountId, updatedAt: new Date().toISOString() }; save(state); return { armed: true }; }
    const slug = findSlackMessageTrigger(rows(await client.triggers.listTypes({ toolkits: ["slack"], limit: 200 }))) ?? FALLBACK_TRIGGER_SLUG;
    const created = await client.triggers.create(composioUserIdFor(employeeId), slug, { connectedAccountId: connection.connectedAccountId });
    const id = field(created as Record<string, unknown>, "id", "triggerId");
    if (!id) return { armed: false, reason: "Composio did not return a trigger id" };
    const state = load(); state[employeeId] = { triggerId: id, triggerSlug: slug, connectedAccountId: connection.connectedAccountId, updatedAt: new Date().toISOString() }; save(state);
    return { armed: true };
  } catch (error) { return { armed: false, reason: error instanceof Error ? error.message : String(error) }; }
}
export async function disableSlackTrigger(employeeId: string): Promise<void> { const trigger = slackTriggerFor(employeeId); const state = load(); delete state[employeeId]; save(state); if (trigger) try { await (getComposio() as unknown as Client).triggers.disable(trigger.triggerId); } catch {} }
