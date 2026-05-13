// Server-only. Wraps the Composio TypeScript SDK + Claude Agent SDK provider so
// each twin can take real action across Slack, GitHub, Linear, Gmail, etc.

import path from "path";
import fs from "fs/promises";
import { Composio } from "@composio/core";
import { ClaudeAgentSDKProvider } from "@composio/claude-agent-sdk";
import { createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import type { McpSdkServerConfigWithInstance } from "@anthropic-ai/claude-agent-sdk";

// ─── Toolkit allow-list per role ─────────────────────────────────────────────
// Curated so each twin can't act outside its functional area.
// Toolkit slugs come from https://docs.composio.dev/toolkits

// Per-employee toolkit allow-lists are configured at runtime through the
// /connections UI and persisted in data/employees/{id}/. This in-memory map
// is just a session cache; on cold start it's empty and the default
// allow-list applies until the CEO picks specific toolkits per role.
const ROLE_TOOLKITS: Record<string, string[]> = {};

const DEFAULT_TOOLKITS = ["slack", "gmail"];

export function getEmployeeToolkits(employeeId: string): string[] {
  return ROLE_TOOLKITS[employeeId] ?? DEFAULT_TOOLKITS;
}

// ─── Composio user_id mapping ─────────────────────────────────────────────────
// We use the employee id directly as the Composio user_id, namespaced.
// Stored on disk in data/employees/{id}/.composio.json so the demo works
// without a database. Move to Supabase when wired.

export function composioUserIdFor(employeeId: string): string {
  return `employee:${employeeId}`;
}

const STATE_DIR = (id: string) =>
  path.join(process.cwd(), "data", "employees", id);
const STATE_FILE = (id: string) =>
  path.join(STATE_DIR(id), ".composio.json");

/** Composio uses INITIALIZING for not-yet-completed OAuth, INITIATED, ACTIVE, EXPIRED, FAILED, INACTIVE. */
export type ConnectionStatus =
  | "INITIALIZING"
  | "INITIATED"
  | "ACTIVE"
  | "EXPIRED"
  | "FAILED"
  | "INACTIVE";

export type ConnectionRecord = {
  toolkit: string;
  status: ConnectionStatus;
  authConfigId?: string;
  connectedAccountId?: string;
  redirectUrl?: string;
  initiatedAt: string;
  activatedAt?: string;
};

/** Coarse status buckets used by the UI. */
export function bucketStatus(
  s: ConnectionStatus | string
): "active" | "pending" | "broken" | "disconnected" {
  const v = String(s).toUpperCase();
  if (v === "ACTIVE") return "active";
  if (v === "INITIALIZING" || v === "INITIATED") return "pending";
  if (v === "EXPIRED" || v === "FAILED") return "broken";
  return "disconnected";
}

export type EmployeeComposioState = {
  composioUserId: string;
  connections: Record<string, ConnectionRecord>; // keyed by toolkit slug
};

export async function readState(
  employeeId: string
): Promise<EmployeeComposioState> {
  try {
    const raw = await fs.readFile(STATE_FILE(employeeId), "utf-8");
    return JSON.parse(raw) as EmployeeComposioState;
  } catch {
    return {
      composioUserId: composioUserIdFor(employeeId),
      connections: {},
    };
  }
}

export async function writeState(
  employeeId: string,
  state: EmployeeComposioState
): Promise<void> {
  await fs.mkdir(STATE_DIR(employeeId), { recursive: true });
  await fs.writeFile(STATE_FILE(employeeId), JSON.stringify(state, null, 2));
}

// ─── Composio client ──────────────────────────────────────────────────────────

let _composio: Composio<ClaudeAgentSDKProvider> | null = null;

export function getComposio(): Composio<ClaudeAgentSDKProvider> {
  if (_composio) return _composio;
  if (!process.env.COMPOSIO_API_KEY) {
    throw new Error("COMPOSIO_API_KEY is not set");
  }
  _composio = new Composio({
    apiKey: process.env.COMPOSIO_API_KEY,
    provider: new ClaudeAgentSDKProvider(),
  });
  return _composio;
}

export function isComposioConfigured(): boolean {
  return Boolean(process.env.COMPOSIO_API_KEY);
}

// ─── Auth config + connection lifecycle ──────────────────────────────────────

/**
 * Get or create a Composio-managed auth config for a toolkit.
 * Composio-managed auth means we don't need to register our own OAuth app
 * with each provider — Composio's shared OAuth app handles it.
 *
 * Returns the auth config id.
 */
async function getOrCreateAuthConfig(
  toolkit: string
): Promise<string> {
  const composio = getComposio();
  // List existing auth configs for this toolkit
  const existing = await composio.authConfigs.list({
    toolkit,
  });
  const list = (existing as { items?: Array<{ id: string }> }).items ?? [];
  if (list.length > 0) {
    return list[0].id;
  }
  // Create a new Composio-managed config
  const created = await composio.authConfigs.create(toolkit, {
    type: "use_composio_managed_auth",
  });
  return created.id;
}

/**
 * Initiate an OAuth connection for an employee + toolkit.
 * Returns a redirect URL to send the user to. Once they complete OAuth,
 * Composio flips the connection to ACTIVE; our caller polls or webhooks.
 */
export async function initiateConnection(
  employeeId: string,
  toolkit: string,
  callbackUrl?: string
): Promise<{ redirectUrl: string; connectedAccountId: string; authConfigId: string }> {
  const composio = getComposio();
  const userId = composioUserIdFor(employeeId);
  const authConfigId = await getOrCreateAuthConfig(toolkit);

  const request = await composio.connectedAccounts.link(userId, authConfigId, {
    callbackUrl,
  });

  const redirectUrl = request.redirectUrl ?? "";
  // ConnectionRequest carries an id — typings vary across versions, so coerce.
  const connectedAccountId =
    (request as { id?: string; connectedAccountId?: string }).connectedAccountId ??
    (request as { id?: string }).id ??
    "";

  // Persist locally so the UI can show pending state
  const state = await readState(employeeId);
  state.connections[toolkit] = {
    toolkit,
    status: "INITIALIZING",
    authConfigId,
    connectedAccountId,
    redirectUrl,
    initiatedAt: new Date().toISOString(),
  };
  await writeState(employeeId, state);

  return { redirectUrl, connectedAccountId, authConfigId };
}

/**
 * Refresh connection statuses for an employee from Composio.
 * Updates our local state file and returns the freshest snapshot.
 */
export async function refreshConnections(
  employeeId: string
): Promise<EmployeeComposioState> {
  if (!isComposioConfigured()) return readState(employeeId);

  const composio = getComposio();
  const userId = composioUserIdFor(employeeId);

  const remote = await composio.connectedAccounts.list({
    userIds: [userId],
  });
  const items =
    (remote as { items?: Array<{
      id: string;
      status: string;
      toolkit?: { slug?: string } | string;
      authConfig?: { id?: string };
    }> }).items ?? [];

  const state = await readState(employeeId);

  // Status priority: ACTIVE wins over INITIATED/INITIALIZING wins over EXPIRED/FAILED.
  const statusRank = (s: string) => {
    const v = s.toUpperCase();
    if (v === "ACTIVE") return 3;
    if (v === "INITIATED" || v === "INITIALIZING") return 2;
    return 1; // EXPIRED / FAILED / unknown
  };

  for (const item of items) {
    const toolkit =
      typeof item.toolkit === "string"
        ? item.toolkit
        : item.toolkit?.slug ?? "";
    if (!toolkit) continue;

    const itemStatus = (item.status?.toUpperCase?.() ?? "INITIALIZING") as ConnectionStatus;
    const prev = state.connections[toolkit];

    // Never let a lower-priority status overwrite a better one already stored.
    if (prev && statusRank(itemStatus) < statusRank(prev.status)) continue;

    state.connections[toolkit] = {
      toolkit,
      status: itemStatus,
      authConfigId: item.authConfig?.id ?? prev?.authConfigId,
      connectedAccountId: item.id,
      redirectUrl: prev?.redirectUrl,
      initiatedAt: prev?.initiatedAt ?? new Date().toISOString(),
      activatedAt:
        itemStatus === "ACTIVE" && !prev?.activatedAt
          ? new Date().toISOString()
          : prev?.activatedAt,
    };
  }

  await writeState(employeeId, state);
  return state;
}

/**
 * Disconnect a toolkit by deleting the connected account on Composio's side.
 */
export async function disconnectToolkit(
  employeeId: string,
  toolkit: string
): Promise<void> {
  if (!isComposioConfigured()) return;
  const composio = getComposio();
  const state = await readState(employeeId);
  const conn = state.connections[toolkit];
  if (!conn?.connectedAccountId) return;

  try {
    await composio.connectedAccounts.delete(conn.connectedAccountId);
  } catch {
    // tolerate already-deleted
  }

  delete state.connections[toolkit];
  await writeState(employeeId, state);
}

// ─── Build an SDK MCP server for an employee ─────────────────────────────────

/**
 * Create an in-process MCP server that exposes the employee's connected
 * Composio tools. The server is plugged into the Claude Agent SDK's
 * `mcpServers` option so the twin can call any tool the employee authorized.
 *
 * Returns null if Composio is not configured OR the employee has no active
 * connections — caller can decide whether to run the agent without tools.
 */
export async function buildEmployeeMcpServer(
  employeeId: string
): Promise<McpSdkServerConfigWithInstance | null> {
  if (!isComposioConfigured()) return null;

  const composio = getComposio();
  const userId = composioUserIdFor(employeeId);

  // Expose every toolkit the user explicitly connected for this employee.
  // The role allow-list (getEmployeeToolkits) is a UI "Recommended" hint
  // only — once the CEO OAuths a toolkit they expect the twin to use it.
  const state = await refreshConnections(employeeId);
  const toolkits = Object.values(state.connections)
    .filter((c) => c.status === "ACTIVE")
    .map((c) => c.toolkit);

  if (toolkits.length === 0) return null;

  // Pull tools per-toolkit so the SDK's default page size never silently
  // drops a toolkit (e.g. requesting [github, gmail] together returned the
  // first 20 tools, all GitHub, leaving Gmail invisible to the agent).
  // `important: true` favors the most-used actions per toolkit; `limit: 50`
  // is plenty for any single integration.
  type ToolList = Awaited<ReturnType<typeof composio.tools.get>>;
  const perToolkit = await Promise.all(
    toolkits.map((toolkit) =>
      composio.tools.get(userId, {
        toolkits: [toolkit],
        important: true,
        limit: 50,
      }) as Promise<ToolList>
    )
  );
  // Each call returns the provider's wrapped collection (an array of tools
  // for ClaudeAgentSDKProvider). Flatten and dedupe by name/slug.
  const seen = new Set<string>();
  const merged: unknown[] = [];
  for (const batch of perToolkit) {
    const arr = Array.isArray(batch)
      ? (batch as unknown[])
      : ([batch] as unknown[]);
    for (const t of arr) {
      const v = t as { name?: string; slug?: string };
      const key = v.name ?? v.slug ?? JSON.stringify(t);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(t);
    }
  }
  const tools = merged as ToolList;

  return createSdkMcpServer({
    name: "composio",
    version: "1.0.0",
    tools: tools as Parameters<typeof createSdkMcpServer>[0]["tools"],
  });
}
