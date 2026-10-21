import fs from "fs";
import { dataDir } from "@/lib/app-home";
import path from "path";
import { getComposio, composioUserIdFor, readState } from "@/lib/composio-client";
import { acceptWebhookOnce, timestampFresh } from "@/lib/webhook-replay";

const FILE = () => dataDir("org", "email-triggers.json");
const FALLBACK_TRIGGER_SLUG = "GMAIL_NEW_GMAIL_MESSAGE";
const LIMIT = 200;
const RETRY_AFTER_MS = 5 * 60 * 1000;
const lastSetupAttempt = new Map<string, number>();
export type EmailTrigger = { triggerId: string; triggerSlug: string; connectedAccountId?: string; updatedAt: string };
type TriggerState = Record<string, EmailTrigger>;
function load(): TriggerState { try { const value: unknown = JSON.parse(fs.readFileSync(FILE(), "utf8")); return value && typeof value === "object" && !Array.isArray(value) ? value as TriggerState : {}; } catch { return {}; } }
function save(state: TriggerState): void { const file = FILE(); fs.mkdirSync(path.dirname(file), { recursive: true }); const temp = `${file}.tmp`; fs.writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, "utf8"); fs.renameSync(temp, file); }
export function emailTriggerFor(employeeId: string): EmailTrigger | undefined { return load()[employeeId]; }
function remember(employeeId: string, trigger: EmailTrigger): void { const state = load(); state[employeeId] = trigger; save(state); }
export function forgetEmailTrigger(employeeId: string): void { const state = load(); delete state[employeeId]; save(state); }

export function publicWebhookUrl(env: Record<string, string | undefined> = process.env, route = "/api/email/composio"): string | null {
  const configured = (env.EMPLOYEE001_PUBLIC_URL ?? env.APP_URL ?? "").trim().replace(/\/$/, "");
  if (!configured) return null;
  try { const url = new URL(configured); return url.protocol === "https:" && !["localhost", "127.0.0.1", "::1"].includes(url.hostname) ? `${url.toString().replace(/\/$/, "")}${route}` : null; } catch { return null; }
}
export function emailPollIntervalMs(pushArmed: boolean): number { return pushArmed ? 30 * 60 * 1000 : 5 * 60 * 1000; }
function rows(value: unknown): Record<string, unknown>[] { const list = Array.isArray(value) ? value : value && typeof value === "object" ? (value as Record<string, unknown>).items : undefined; return Array.isArray(list) ? list.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object" && !Array.isArray(row)) : []; }
function field(row: Record<string, unknown>, ...keys: string[]): string | undefined { for (const key of keys) if (typeof row[key] === "string" && row[key]) return row[key] as string; return undefined; }
export function findNewMailTrigger(items: Record<string, unknown>[]): string | null { let best: { slug: string; score: number } | null = null; for (const item of items) { const slug = field(item, "slug", "name"); if (!slug) continue; const haystack = `${slug} ${field(item, "description") ?? ""}`.toUpperCase(); let score = (/NEW/.test(haystack) ? 3 : 0) + (/MESSAGE|MAIL|EMAIL/.test(haystack) ? 3 : 0) + (/RECEIV|ARRIV|INBOX/.test(haystack) ? 1 : 0); if (/DRAFT|LABEL|ATTACHMENT|THREAD|SENT|DELETE|TRASH/.test(haystack)) score -= 5; if (score >= 6 && (!best || score > best.score)) best = { slug, score }; } return best?.slug ?? null; }
type TriggerClient = { triggers: { listActive(query?: unknown): Promise<unknown>; listTypes(query?: unknown): Promise<unknown>; create(userId: string, slug: string, body?: unknown): Promise<unknown>; disable(triggerId: string): Promise<unknown> } };

/** Arm only when Composio can reach a signed, public HTTPS route. */
export async function ensureEmailTrigger(employeeId: string): Promise<{ armed: boolean; reason?: string }> {
  const webhookUrl = publicWebhookUrl();
  if (!webhookUrl) return { armed: false, reason: "no public HTTPS APP_URL/EMPLOYEE001_PUBLIC_URL" };
  if (!process.env.COMPOSIO_WEBHOOK_SECRET) return { armed: false, reason: "COMPOSIO_WEBHOOK_SECRET is not set" };
  const now = Date.now();
  if (now - (lastSetupAttempt.get(employeeId) ?? 0) < RETRY_AFTER_MS) return { armed: false, reason: "trigger setup retry is deferred" };
  lastSetupAttempt.set(employeeId, now);
  try {
    const connection = (await readState(employeeId)).connections.gmail;
    if (connection?.status !== "ACTIVE") return { armed: false, reason: "Gmail is not active" };
    const client = getComposio() as unknown as TriggerClient;
    const active = rows(await client.triggers.listActive({ connectedAccountIds: connection.connectedAccountId ? [connection.connectedAccountId] : undefined, showDisabled: true, limit: LIMIT }));
    const existing = active.find((item) => field(item, "connectedAccountId", "connected_account_id") === connection.connectedAccountId && field(item, "id", "triggerId"));
    if (existing) { remember(employeeId, { triggerId: field(existing, "id", "triggerId")!, triggerSlug: field(existing, "triggerName", "triggerSlug", "trigger_name") ?? FALLBACK_TRIGGER_SLUG, connectedAccountId: connection.connectedAccountId, updatedAt: new Date().toISOString() }); return { armed: true }; }
    let slug: string | null = null;
    try { slug = findNewMailTrigger(rows(await client.triggers.listTypes({ toolkits: ["gmail"], limit: LIMIT }))); } catch { /* documented SDK fallback below */ }
    slug ??= FALLBACK_TRIGGER_SLUG;
    // v0.8 receives delivery through the project webhook subscription configured
    // in Composio; triggerConfig is Gmail-specific and must not be invented here.
    const created = await client.triggers.create(composioUserIdFor(employeeId), slug, { connectedAccountId: connection.connectedAccountId });
    const createdRow = created && typeof created === "object" ? created as Record<string, unknown> : {};
    const triggerId = field(createdRow, "id", "triggerId");
    if (!triggerId) return { armed: false, reason: "Composio did not return a trigger id" };
    remember(employeeId, { triggerId, triggerSlug: slug, connectedAccountId: connection.connectedAccountId, updatedAt: new Date().toISOString() });
    console.log(`[email-intake] ${employeeId}: Composio push trigger armed`);
    return { armed: true };
  } catch (error) { const reason = error instanceof Error ? error.message : String(error); console.warn(`[email-intake] ${employeeId}: push unavailable; using 5-minute polling (${reason.slice(0, 160)})`); return { armed: false, reason }; }
}
export async function disableEmailTrigger(employeeId: string): Promise<void> { const trigger = emailTriggerFor(employeeId); forgetEmailTrigger(employeeId); if (!trigger) return; try { await (getComposio() as unknown as TriggerClient).triggers.disable(trigger.triggerId); } catch { /* local record must clear */ } }
export type WebhookVerifier = (params: { payload: string; signature: string; id: string; timestamp: string; secret: string }) => Promise<unknown>;
/** Signature (Composio SDK), then replay protection: a stale timestamp or a
 *  webhook id already seen returns null like a bad signature. */
export async function verifyComposioWebhook(input: { payload: string; signature: string | null; id: string | null; timestamp: string | null; secret?: string; scope?: string; now?: number }, verifier?: WebhookVerifier): Promise<unknown | null> {
  if (!input.secret || !input.signature || !input.id || !input.timestamp) return null;
  if (!timestampFresh(input.timestamp, input.now).ok) return null;
  let verified: unknown;
  try {
    const verify = verifier ?? ((params) => (getComposio() as unknown as { triggers: { verifyWebhook(value: typeof params): Promise<unknown> } }).triggers.verifyWebhook(params));
    verified = await verify({ payload: input.payload, signature: input.signature, id: input.id, timestamp: input.timestamp, secret: input.secret });
  } catch {
    return null;
  }
  if (!verified) return null;
  return acceptWebhookOnce(input.scope ?? "composio", input.id, input.timestamp, input.now).ok ? verified : null;
}
