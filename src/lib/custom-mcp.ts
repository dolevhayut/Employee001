// Server-only. Org-wide custom MCP servers: a CEO connects an MCP endpoint
// once at the workspace level (e.g. Supabase, an internal API) and every
// twin in the org inherits the tools. Per-employee Composio MCP keeps its
// own scope; this is the global layer that merges on top.
//
// Storage: a single JSON file at data/org/custom-mcp.json (gitignored).
// Single-tenant for now; promote to a per-org table when multi-tenant lands.

import path from "path";
import fs from "fs/promises";
import type {
  McpHttpServerConfig,
  McpSSEServerConfig,
  McpServerConfig,
} from "@anthropic-ai/claude-agent-sdk";

export type CustomMcpTransport = "http" | "sse";

export type CustomMcpHeader = {
  key: string;
  value: string;
};

export type CustomMcpServer = {
  /** Stable id used in URLs and as the key in the `mcpServers` map. */
  id: string;
  /** Display name shown in the UI. Also used as the MCP server key (sanitized). */
  name: string;
  /** Optional one-liner shown in the UI. */
  description?: string;
  transport: CustomMcpTransport;
  url: string;
  /** Auth + arbitrary headers. Stored on disk; rotate via the UI. */
  headers: CustomMcpHeader[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

const STATE_DIR = path.join(process.cwd(), "data", "org");
const STATE_FILE = path.join(STATE_DIR, "custom-mcp.json");

type FileShape = {
  servers: CustomMcpServer[];
};

async function readFile(): Promise<FileShape> {
  try {
    const raw = await fs.readFile(STATE_FILE, "utf-8");
    const parsed = JSON.parse(raw) as FileShape;
    return { servers: Array.isArray(parsed.servers) ? parsed.servers : [] };
  } catch {
    return { servers: [] };
  }
}

async function writeFile(state: FileShape): Promise<void> {
  await fs.mkdir(STATE_DIR, { recursive: true });
  await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2));
}

// ─── CRUD ────────────────────────────────────────────────────────────────────

export async function listCustomMcp(): Promise<CustomMcpServer[]> {
  const { servers } = await readFile();
  return [...servers].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

export type CreateCustomMcpInput = {
  name: string;
  description?: string;
  transport: CustomMcpTransport;
  url: string;
  headers?: CustomMcpHeader[];
  enabled?: boolean;
};

export async function createCustomMcp(
  input: CreateCustomMcpInput
): Promise<CustomMcpServer> {
  const errors = validateInput(input);
  if (errors) throw new Error(errors);

  const now = new Date().toISOString();
  const server: CustomMcpServer = {
    id: makeId(),
    name: input.name.trim(),
    description: input.description?.trim() || undefined,
    transport: input.transport,
    url: input.url.trim(),
    headers: cleanHeaders(input.headers ?? []),
    enabled: input.enabled ?? true,
    createdAt: now,
    updatedAt: now,
  };

  const state = await readFile();
  if (state.servers.some((s) => sanitizeKey(s.name) === sanitizeKey(server.name))) {
    throw new Error(
      `An MCP server named "${server.name}" already exists. Pick a different name.`
    );
  }
  state.servers.push(server);
  await writeFile(state);
  return server;
}

export type UpdateCustomMcpInput = Partial<
  Omit<CreateCustomMcpInput, "transport">
> & {
  transport?: CustomMcpTransport;
};

export async function updateCustomMcp(
  id: string,
  patch: UpdateCustomMcpInput
): Promise<CustomMcpServer | null> {
  const state = await readFile();
  const idx = state.servers.findIndex((s) => s.id === id);
  if (idx === -1) return null;

  const current = state.servers[idx];
  const next: CustomMcpServer = {
    ...current,
    ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
    ...(patch.description !== undefined
      ? { description: patch.description.trim() || undefined }
      : {}),
    ...(patch.transport !== undefined ? { transport: patch.transport } : {}),
    ...(patch.url !== undefined ? { url: patch.url.trim() } : {}),
    ...(patch.headers !== undefined
      ? { headers: cleanHeaders(patch.headers) }
      : {}),
    ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
    updatedAt: new Date().toISOString(),
  };

  const errors = validateInput(next);
  if (errors) throw new Error(errors);

  // Name collision check (excluding self).
  const nextKey = sanitizeKey(next.name);
  if (
    state.servers.some(
      (s, i) => i !== idx && sanitizeKey(s.name) === nextKey
    )
  ) {
    throw new Error(
      `An MCP server named "${next.name}" already exists. Pick a different name.`
    );
  }

  state.servers[idx] = next;
  await writeFile(state);
  return next;
}

export async function deleteCustomMcp(id: string): Promise<boolean> {
  const state = await readFile();
  const before = state.servers.length;
  state.servers = state.servers.filter((s) => s.id !== id);
  if (state.servers.length === before) return false;
  await writeFile(state);
  return true;
}

// ─── Runtime loader ──────────────────────────────────────────────────────────

/**
 * Load all enabled org-wide custom MCP servers as a config map ready to plug
 * into `query({ options: { mcpServers } })`. Caller merges with per-employee
 * Composio so each twin sees both layers.
 *
 * Keys are sanitized from the server's `name` so the agent sees stable
 * `mcp__<name>__<tool>` identifiers even if the display name changes case.
 */
export async function loadOrgCustomMcpServers(): Promise<
  Record<string, McpServerConfig>
> {
  const all = await listCustomMcp();
  const enabled = all.filter((s) => s.enabled && s.url);
  if (enabled.length === 0) return {};

  const map: Record<string, McpServerConfig> = {};
  for (const s of enabled) {
    const key = sanitizeKey(s.name) || `mcp_${s.id}`;
    if (map[key]) continue; // collision-safe; first wins
    const headers = headersAsRecord(s.headers);
    if (s.transport === "http") {
      const cfg: McpHttpServerConfig = {
        type: "http",
        url: s.url,
        ...(Object.keys(headers).length > 0 ? { headers } : {}),
      };
      map[key] = cfg;
    } else {
      const cfg: McpSSEServerConfig = {
        type: "sse",
        url: s.url,
        ...(Object.keys(headers).length > 0 ? { headers } : {}),
      };
      map[key] = cfg;
    }
  }
  return map;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeId(): string {
  return `mcp_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

/**
 * Turn a display name into a stable MCP server key (lowercase, alphanumeric +
 * underscore). The agent sees tools as `mcp__<key>__<tool>`, so keep this
 * deterministic and short.
 */
function sanitizeKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32);
}

function cleanHeaders(headers: CustomMcpHeader[]): CustomMcpHeader[] {
  return headers
    .map((h) => ({ key: h.key.trim(), value: h.value.trim() }))
    .filter((h) => h.key && h.value);
}

function headersAsRecord(headers: CustomMcpHeader[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const h of headers) out[h.key] = h.value;
  return out;
}

function validateInput(input: {
  name?: string;
  url?: string;
  transport?: CustomMcpTransport;
}): string | null {
  if (!input.name || !input.name.trim()) return "Name is required.";
  if (!input.url || !input.url.trim()) return "URL is required.";
  try {
    const u = new URL(input.url);
    if (u.protocol !== "https:" && u.protocol !== "http:") {
      return "URL must be http(s).";
    }
  } catch {
    return "URL is not valid.";
  }
  if (input.transport && input.transport !== "http" && input.transport !== "sse") {
    return "Transport must be 'http' or 'sse'.";
  }
  if (sanitizeKey(input.name).length === 0) {
    return "Name must contain at least one alphanumeric character.";
  }
  return null;
}

/** Expose key derivation for the UI so it can show users the agent-facing slug. */
export function previewKey(name: string): string {
  return sanitizeKey(name);
}
