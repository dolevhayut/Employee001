// Microsoft Graph delegated-auth client. Replaces composio-client at the
// platform layer while preserving its public surface so all existing API
// routes (/api/connections/*, onboarding, invites) and twin runners keep
// compiling without per-call-site rewrites.
//
// Auth model: per-employee MSAL device-code flow. Tokens live on disk under
// `data/employees/{id}/.graph.json` (mirrors composio-client's state file).
// Once a user completes the device code, the same access/refresh-token pair
// unlocks every Graph "toolkit" (mail / teams / drive / planner / todo /
// sharepoint) — Microsoft has a single token, not one per integration.

import "server-only";
import path from "path";
import fs from "fs/promises";
import {
  PublicClientApplication,
  type Configuration,
  type AuthenticationResult,
  type AccountInfo,
} from "@azure/msal-node";
import { createSdkMcpServer } from "@/lib/agent-sdk/mcp-server";
import { buildGraphTools, type GraphAuthProvider } from "@/lib/graph-tools";
import type { McpSdkServerConfigWithInstance } from "@/lib/agent-sdk/types";

// ─── Microsoft Graph "toolkits" the UI knows about ──────────────────────────

export const GRAPH_TOOLKITS = [
  "outlook",
  "teams",
  "onedrive",
  "sharepoint",
  "planner",
  "todo",
] as const;
export type GraphToolkit = (typeof GRAPH_TOOLKITS)[number];

const DEFAULT_TOOLKITS: string[] = ["outlook", "teams"];

const ROLE_TOOLKITS: Record<string, string[]> = {};
export function getEmployeeToolkits(employeeId: string): string[] {
  return ROLE_TOOLKITS[employeeId] ?? DEFAULT_TOOLKITS;
}

// Per-toolkit catalog entry shown in the /connections UI.
export type GraphToolkitInfo = {
  slug: GraphToolkit;
  name: string;
  description: string;
  iconUrl?: string;
  authSchemes: string[];
  toolsCount: number;
  noAuth: boolean;
};

export const GRAPH_TOOLKIT_CATALOG: GraphToolkitInfo[] = [
  {
    slug: "outlook",
    name: "Outlook",
    description: "Send & search email, create calendar events. Delegated access only.",
    authSchemes: ["OAUTH_DEVICE_CODE"],
    toolsCount: 3,
    noAuth: false,
  },
  {
    slug: "teams",
    name: "Microsoft Teams",
    description: "Post channel messages, send 1:1 chats.",
    authSchemes: ["OAUTH_DEVICE_CODE"],
    toolsCount: 2,
    noAuth: false,
  },
  {
    slug: "onedrive",
    name: "OneDrive",
    description: "Upload, download, and search files in the user's drive.",
    authSchemes: ["OAUTH_DEVICE_CODE"],
    toolsCount: 2,
    noAuth: false,
  },
  {
    slug: "sharepoint",
    name: "SharePoint",
    description: "List files across SharePoint document libraries the user can access.",
    authSchemes: ["OAUTH_DEVICE_CODE"],
    toolsCount: 1,
    noAuth: false,
  },
  {
    slug: "planner",
    name: "Microsoft Planner",
    description: "Create and list Planner tasks for the connected user.",
    authSchemes: ["OAUTH_DEVICE_CODE"],
    toolsCount: 2,
    noAuth: false,
  },
  {
    slug: "todo",
    name: "Microsoft To Do",
    description: "Create personal To Do tasks.",
    authSchemes: ["OAUTH_DEVICE_CODE"],
    toolsCount: 1,
    noAuth: false,
  },
];

const GRAPH_SCOPES = [
  "User.Read",
  "Mail.ReadWrite",
  "Mail.Send",
  "Files.ReadWrite.All",
  "Tasks.ReadWrite",
  "ChannelMessage.Send",
  "Chat.ReadWrite",
  "offline_access",
];

// ─── Composio-compatible connection state ───────────────────────────────────

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

export type EmployeeComposioState = {
  composioUserId: string;
  connections: Record<string, ConnectionRecord>;
};

export function bucketStatus(
  s: ConnectionStatus | string
): "active" | "pending" | "broken" | "disconnected" {
  const v = String(s).toUpperCase();
  if (v === "ACTIVE") return "active";
  if (v === "INITIALIZING" || v === "INITIATED") return "pending";
  if (v === "EXPIRED" || v === "FAILED") return "broken";
  return "disconnected";
}

export function composioUserIdFor(employeeId: string): string {
  return `employee:${employeeId}`;
}

const STATE_DIR = (id: string) => path.join(process.cwd(), "data", "employees", id);
const STATE_FILE = (id: string) => path.join(STATE_DIR(id), ".graph.json");

type StoredGraphState = EmployeeComposioState & {
  tokenCache?: string; // MSAL serialised cache
  account?: AccountInfo;
};

export async function readState(employeeId: string): Promise<EmployeeComposioState> {
  try {
    const raw = await fs.readFile(STATE_FILE(employeeId), "utf-8");
    const parsed = JSON.parse(raw) as StoredGraphState;
    return {
      composioUserId: parsed.composioUserId ?? composioUserIdFor(employeeId),
      connections: parsed.connections ?? {},
    };
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
  // Preserve the MSAL token cache if present.
  let existing: StoredGraphState = {} as StoredGraphState;
  try {
    existing = JSON.parse(await fs.readFile(STATE_FILE(employeeId), "utf-8"));
  } catch { /* fresh */ }
  const merged: StoredGraphState = {
    ...existing,
    composioUserId: state.composioUserId,
    connections: state.connections,
  };
  await fs.writeFile(STATE_FILE(employeeId), JSON.stringify(merged, null, 2));
}

async function readStoredFull(employeeId: string): Promise<StoredGraphState> {
  try {
    return JSON.parse(await fs.readFile(STATE_FILE(employeeId), "utf-8"));
  } catch {
    return {
      composioUserId: composioUserIdFor(employeeId),
      connections: {},
    };
  }
}

async function writeStoredFull(
  employeeId: string,
  state: StoredGraphState
): Promise<void> {
  await fs.mkdir(STATE_DIR(employeeId), { recursive: true });
  await fs.writeFile(STATE_FILE(employeeId), JSON.stringify(state, null, 2));
}

// ─── MSAL public client ─────────────────────────────────────────────────────

export function isComposioConfigured(): boolean {
  return Boolean(process.env.AZURE_TENANT_ID && process.env.AZURE_CLIENT_ID);
}
export function isGraphConfigured(): boolean {
  return isComposioConfigured();
}

const msalCache: Record<string, PublicClientApplication> = {};

function buildMsalClient(employeeId: string, serializedCache?: string): PublicClientApplication {
  const tenant = process.env.AZURE_TENANT_ID ?? "common";
  const clientId = process.env.AZURE_CLIENT_ID;
  if (!clientId) throw new Error("AZURE_CLIENT_ID is not set");

  const config: Configuration = {
    auth: {
      clientId,
      authority: `https://login.microsoftonline.com/${tenant}`,
    },
    cache: {},
  };
  const pca = new PublicClientApplication(config);
  if (serializedCache) {
    try {
      pca.getTokenCache().deserialize(serializedCache);
    } catch { /* corrupt cache → fall through to fresh login */ }
  }
  msalCache[employeeId] = pca;
  return pca;
}

async function getMsalClient(employeeId: string): Promise<PublicClientApplication> {
  if (msalCache[employeeId]) return msalCache[employeeId];
  const stored = await readStoredFull(employeeId);
  return buildMsalClient(employeeId, stored.tokenCache);
}

async function persistMsalCache(
  employeeId: string,
  pca: PublicClientApplication,
  account?: AccountInfo
): Promise<void> {
  const tokenCache = pca.getTokenCache().serialize();
  const stored = await readStoredFull(employeeId);
  stored.tokenCache = tokenCache;
  if (account) stored.account = account;
  await writeStoredFull(employeeId, stored);
}

// ─── Composio-shaped "client" object that getComposio() returns ────────────

/**
 * Returns an object mimicking enough of `composio.toolkits.get(...)` /
 * `composio.connectedAccounts.list(...)` for the UI routes to keep
 * compiling. Internally backed by our static Graph catalog + the per-employee
 * connection state files.
 */
export function getComposio() {
  return {
    toolkits: {
      get: async (opts?: { limit?: number; toolkits?: string[] }) => {
        // Catalogs for the /connections UI.
        const allowed = new Set((opts?.toolkits ?? []).map((s) => s.toLowerCase()));
        const items = GRAPH_TOOLKIT_CATALOG.filter((t) =>
          allowed.size > 0 ? allowed.has(t.slug) : true
        ).slice(0, opts?.limit ?? 100);
        return { items };
      },
    },
    connectedAccounts: {
      list: async (opts: { userIds?: string[] }) => {
        const userIds = opts.userIds ?? [];
        const items: Array<{
          id: string;
          status: string;
          toolkit: { slug: string };
        }> = [];
        for (const uid of userIds) {
          const empId = uid.replace(/^employee:/, "");
          const state = await readState(empId);
          for (const c of Object.values(state.connections)) {
            items.push({
              id: c.connectedAccountId ?? `${empId}-${c.toolkit}`,
              status: c.status,
              toolkit: { slug: c.toolkit },
            });
          }
        }
        return { items };
      },
      delete: async (_id: string) => {
        // No-op: deletion is handled in disconnectToolkit which flips status
        // and clears the entry.
      },
    },
    tools: {
      get: async (
        _userId?: string,
        _opts?: { toolkits?: string[]; important?: boolean; limit?: number }
      ) => [] as unknown[],
      execute: async (
        toolSlug: string,
        _args: { userId?: string; arguments?: Record<string, unknown> }
      ) => ({
        error: `Composio tool execute is no longer available. Use the Microsoft Graph MCP tools instead. (requested: ${toolSlug})`,
      }),
    },
    authConfigs: {
      list: async () => ({ items: [] as Array<{ id: string }> }),
      create: async () => ({ id: "graph-device-code" }),
    },
  };
}

// ─── Device-code OAuth flow ─────────────────────────────────────────────────

export type DeviceCodeChallenge = {
  userCode: string;
  verificationUri: string;
  message: string;
  expiresIn: number;
};

const pendingDeviceCodes: Record<string, {
  promise: Promise<AuthenticationResult | null>;
  challenge?: DeviceCodeChallenge;
}> = {};

/**
 * Begin a Microsoft device-code login for a given employee. Returns the
 * verification URI + user code immediately; resolves the underlying promise
 * (and saves the token cache) only after the user finishes signing in.
 */
export async function startGraphDeviceLogin(
  employeeId: string
): Promise<DeviceCodeChallenge> {
  const key = `${employeeId}`;
  if (pendingDeviceCodes[key]?.challenge) {
    return pendingDeviceCodes[key].challenge!;
  }
  const pca = await getMsalClient(employeeId);
  let resolveChallenge!: (c: DeviceCodeChallenge) => void;
  const challengePromise = new Promise<DeviceCodeChallenge>((res) => {
    resolveChallenge = res;
  });

  const promise = pca.acquireTokenByDeviceCode({
    scopes: GRAPH_SCOPES,
    deviceCodeCallback: (resp) => {
      const challenge: DeviceCodeChallenge = {
        userCode: resp.userCode,
        verificationUri: resp.verificationUri,
        message: resp.message,
        expiresIn: resp.expiresIn,
      };
      pendingDeviceCodes[key].challenge = challenge;
      resolveChallenge(challenge);
    },
  });

  pendingDeviceCodes[key] = { promise };

  // Background: once the user completes the code, flip every toolkit to ACTIVE.
  promise
    .then(async (auth) => {
      if (!auth) return;
      await persistMsalCache(employeeId, pca, auth.account ?? undefined);
      const state = await readState(employeeId);
      const now = new Date().toISOString();
      for (const toolkit of GRAPH_TOOLKITS) {
        state.connections[toolkit] = {
          toolkit,
          status: "ACTIVE",
          connectedAccountId: auth.account?.homeAccountId ?? auth.uniqueId ?? toolkit,
          initiatedAt: state.connections[toolkit]?.initiatedAt ?? now,
          activatedAt: now,
        };
      }
      await writeState(employeeId, state);
    })
    .catch((err) => {
      console.warn(
        `[graph] device code login failed for ${employeeId}: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    })
    .finally(() => {
      delete pendingDeviceCodes[key];
    });

  return challengePromise;
}

/**
 * Initiate a connection. We don't run separate flows per toolkit — Microsoft
 * grants one token for every scope at once. This kicks off the device flow
 * (if not already pending) and stamps the toolkit row as INITIATED.
 *
 * Returns a URL the UI can deep-link to (https://microsoft.com/devicelogin)
 * and the user code as the "secret" portion. The CEO copies the code and
 * pastes it on the device login page.
 */
export async function initiateConnection(
  employeeId: string,
  toolkit: string,
  _callbackUrl?: string
): Promise<{ redirectUrl: string; connectedAccountId: string; authConfigId: string; userCode?: string; expiresIn?: number; message?: string }> {
  if (!isGraphConfigured()) {
    throw new Error(
      "Microsoft Graph is not configured. Set AZURE_TENANT_ID and AZURE_CLIENT_ID in .env."
    );
  }
  const slug = toolkit.toLowerCase();
  const challenge = await startGraphDeviceLogin(employeeId);
  const state = await readState(employeeId);
  state.connections[slug] = {
    toolkit: slug,
    status: state.connections[slug]?.status === "ACTIVE" ? "ACTIVE" : "INITIATED",
    initiatedAt: state.connections[slug]?.initiatedAt ?? new Date().toISOString(),
    redirectUrl: challenge.verificationUri,
    activatedAt: state.connections[slug]?.activatedAt,
  };
  await writeState(employeeId, state);
  return {
    redirectUrl: challenge.verificationUri,
    connectedAccountId: `${employeeId}-${slug}`,
    authConfigId: "graph-device-code",
    userCode: challenge.userCode,
    expiresIn: challenge.expiresIn,
    message: challenge.message,
  };
}

/**
 * Refresh connection status. With Graph there's no third-party to poll — we
 * just check whether MSAL has a usable account + cached token. If a silent
 * acquisition for User.Read succeeds, every Graph toolkit stays ACTIVE.
 */
export async function refreshConnections(
  employeeId: string
): Promise<EmployeeComposioState> {
  const state = await readState(employeeId);
  if (!isGraphConfigured()) return state;
  try {
    const stored = await readStoredFull(employeeId);
    const pca = buildMsalClient(employeeId, stored.tokenCache);
    const accounts = await pca.getTokenCache().getAllAccounts();
    if (accounts.length === 0) return state;
    const acquired = await pca.acquireTokenSilent({
      account: accounts[0],
      scopes: ["User.Read"],
    });
    if (acquired) {
      await persistMsalCache(employeeId, pca, accounts[0]);
      const now = new Date().toISOString();
      for (const toolkit of GRAPH_TOOLKITS) {
        if (!state.connections[toolkit]) continue;
        state.connections[toolkit].status = "ACTIVE";
        state.connections[toolkit].activatedAt =
          state.connections[toolkit].activatedAt ?? now;
      }
      await writeState(employeeId, state);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[graph] refreshConnections: ${msg}`);
  }
  return state;
}

export async function disconnectToolkit(
  employeeId: string,
  toolkit: string
): Promise<void> {
  const state = await readState(employeeId);
  delete state.connections[toolkit.toLowerCase()];
  if (Object.keys(state.connections).length === 0) {
    // Wipe the cached token entirely when nothing is connected anymore.
    const stored = await readStoredFull(employeeId);
    delete stored.tokenCache;
    delete stored.account;
    stored.connections = {};
    await writeStoredFull(employeeId, stored);
    delete msalCache[employeeId];
  } else {
    await writeState(employeeId, state);
  }
}

// ─── Auth provider for Graph SDK ─────────────────────────────────────────────

export function authProviderFor(employeeId: string): GraphAuthProvider {
  return {
    getToken: async (scopes?: string[]) => {
      const stored = await readStoredFull(employeeId);
      const pca = buildMsalClient(employeeId, stored.tokenCache);
      const accounts = await pca.getTokenCache().getAllAccounts();
      if (accounts.length === 0) {
        throw new Error(
          `Employee ${employeeId} is not signed in to Microsoft Graph. Visit /connections/${employeeId} to start the device-code login.`
        );
      }
      const acquired = await pca.acquireTokenSilent({
        account: accounts[0],
        scopes: scopes ?? GRAPH_SCOPES,
      });
      if (!acquired) throw new Error("Microsoft did not return an access token.");
      await persistMsalCache(employeeId, pca, accounts[0]);
      return acquired.accessToken;
    },
  };
}

// ─── Build the in-process MCP server with all Graph tools ───────────────────

export async function buildEmployeeMcpServer(
  employeeId: string
): Promise<McpSdkServerConfigWithInstance | null> {
  if (!isGraphConfigured()) return null;
  const state = await refreshConnections(employeeId);
  const active = Object.values(state.connections).filter((c) => c.status === "ACTIVE");
  if (active.length === 0) return null;

  const auth = authProviderFor(employeeId);
  const activeToolkits = new Set(active.map((c) => c.toolkit as GraphToolkit));
  return createSdkMcpServer({
    name: "graph",
    version: "1.0.0",
    tools: buildGraphTools(auth, activeToolkits),
  });
}
