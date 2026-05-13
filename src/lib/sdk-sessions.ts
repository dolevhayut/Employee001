// Thin wrapper around the Agent SDK's session helper functions.
// Surfaced through this module so feature code never imports the SDK
// helpers directly — easier to mock in tests, easier to swap for a
// `sessionStore` adapter later (Supabase mirroring is on the roadmap;
// see docs/AGENT-SDK-COVERAGE.md).

import {
  listSessions as sdkListSessions,
  getSessionMessages as sdkGetSessionMessages,
  getSessionInfo as sdkGetSessionInfo,
  renameSession as sdkRenameSession,
  tagSession as sdkTagSession,
  deleteSession as sdkDeleteSession,
  forkSession as sdkForkSession,
  type SDKSessionInfo,
  type SessionMessage,
} from "@anthropic-ai/claude-agent-sdk";

export type { SDKSessionInfo, SessionMessage };

export async function listTwinSessions(opts?: {
  limit?: number;
  cwd?: string;
}): Promise<SDKSessionInfo[]> {
  return sdkListSessions(opts);
}

export async function getTwinSessionMessages(
  sessionId: string
): Promise<SessionMessage[]> {
  return sdkGetSessionMessages(sessionId);
}

export async function getTwinSessionInfo(
  sessionId: string
): Promise<SDKSessionInfo | undefined> {
  return sdkGetSessionInfo(sessionId);
}

export async function renameTwinSession(
  sessionId: string,
  title: string
): Promise<void> {
  return sdkRenameSession(sessionId, title);
}

export async function tagTwinSession(
  sessionId: string,
  tag: string | null
): Promise<void> {
  return sdkTagSession(sessionId, tag);
}

export async function deleteTwinSession(sessionId: string): Promise<void> {
  return sdkDeleteSession(sessionId);
}

/** Branch a session to a new ID without re-running the prior turns. */
export async function forkTwinSession(
  sessionId: string
): Promise<{ sessionId: string }> {
  const result = await sdkForkSession(sessionId);
  return { sessionId: result.sessionId };
}
