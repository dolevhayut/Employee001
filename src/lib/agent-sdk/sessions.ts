// Local JSON-backed session storage. Mirrors the SDK's session helpers so
// twins can resume / fork / list across turns even though we're no longer
// using Anthropic's persistent session store.
//
// Sessions live at `data/sessions/<id>.json` so they survive process restarts
// and are visible to STORAGE_BACKEND=local. When Fabric storage is on, the
// session JSON is still written locally (sessions are transient by design;
// long-term audit lives in the audit_log table).

import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";
import type { SDKSessionInfo, SessionMessage } from "./types";

const SESSION_DIR = () => path.join(process.cwd(), "data", "sessions");

function ensureDir() {
  fs.mkdirSync(SESSION_DIR(), { recursive: true });
}

type StoredSession = {
  sessionId: string;
  cwd?: string;
  title?: string;
  tags?: string[];
  createdAt: string;
  updatedAt: string;
  messages: SessionMessage[];
};

function sessionFile(id: string): string {
  return path.join(SESSION_DIR(), `${id}.json`);
}

function readSession(id: string): StoredSession | null {
  try {
    const raw = fs.readFileSync(sessionFile(id), "utf8");
    return JSON.parse(raw) as StoredSession;
  } catch {
    return null;
  }
}

function writeSession(s: StoredSession): void {
  ensureDir();
  fs.writeFileSync(sessionFile(s.sessionId), JSON.stringify(s, null, 2));
}

export function ensureSessionId(resume?: string, fork = false): string {
  if (resume) {
    const existing = readSession(resume);
    if (existing && !fork) return resume;
    if (existing && fork) {
      const forked = randomUUID();
      const now = new Date().toISOString();
      writeSession({
        ...existing,
        sessionId: forked,
        createdAt: now,
        updatedAt: now,
      });
      return forked;
    }
  }
  const id = randomUUID();
  const now = new Date().toISOString();
  writeSession({
    sessionId: id,
    createdAt: now,
    updatedAt: now,
    messages: [],
  });
  return id;
}

export function recordSessionMessage(id: string, msg: SessionMessage): void {
  const s = readSession(id);
  if (!s) return;
  s.messages.push({ ts: new Date().toISOString(), ...msg });
  s.updatedAt = new Date().toISOString();
  writeSession(s);
}

export async function listSessions(opts?: {
  limit?: number;
  cwd?: string;
}): Promise<SDKSessionInfo[]> {
  ensureDir();
  let files: string[] = [];
  try {
    files = fs.readdirSync(SESSION_DIR()).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  const sessions: SDKSessionInfo[] = [];
  for (const f of files) {
    try {
      const s = JSON.parse(fs.readFileSync(path.join(SESSION_DIR(), f), "utf8")) as StoredSession;
      if (opts?.cwd && s.cwd && s.cwd !== opts.cwd) continue;
      sessions.push({
        sessionId: s.sessionId,
        cwd: s.cwd,
        title: s.title,
        tags: s.tags,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      });
    } catch {
      /* skip corrupt session files */
    }
  }
  sessions.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  return opts?.limit ? sessions.slice(0, opts.limit) : sessions;
}

export async function getSessionMessages(id: string): Promise<SessionMessage[]> {
  const s = readSession(id);
  return s?.messages ?? [];
}

export async function getSessionInfo(id: string): Promise<SDKSessionInfo | undefined> {
  const s = readSession(id);
  if (!s) return undefined;
  return {
    sessionId: s.sessionId,
    cwd: s.cwd,
    title: s.title,
    tags: s.tags,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

export async function renameSession(id: string, title: string): Promise<void> {
  const s = readSession(id);
  if (!s) return;
  s.title = title;
  s.updatedAt = new Date().toISOString();
  writeSession(s);
}

export async function tagSession(id: string, tag: string | null): Promise<void> {
  const s = readSession(id);
  if (!s) return;
  if (tag === null) {
    s.tags = [];
  } else {
    s.tags = Array.from(new Set([...(s.tags ?? []), tag]));
  }
  s.updatedAt = new Date().toISOString();
  writeSession(s);
}

export async function deleteSession(id: string): Promise<void> {
  try {
    fs.unlinkSync(sessionFile(id));
  } catch {
    /* already gone */
  }
}

export async function forkSession(id: string): Promise<{ sessionId: string }> {
  const s = readSession(id);
  if (!s) {
    const fresh = ensureSessionId();
    return { sessionId: fresh };
  }
  const forked = randomUUID();
  const now = new Date().toISOString();
  writeSession({
    ...s,
    sessionId: forked,
    createdAt: now,
    updatedAt: now,
  });
  return { sessionId: forked };
}
