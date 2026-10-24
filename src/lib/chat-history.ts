import fs from "fs";
import path from "path";
import { dataDir } from "./app-home";

export type StoredMessage = {
  role: "user" | "twin";
  /** Who asked (the signed-in user's id), set by the server, never the client. */
  askedBy?: string;
  /** "ask" for the Ask page; missing = the chat page (/flow). */
  surface?: "ask";
  /** Ask page: messages of one conversation share it. */
  conversationId?: string;
  /** Ask page: the steps the twin took, shown again when the conversation reloads. */
  steps?: Array<{ kind: string; label: string; detail?: string; logo?: string }>;
  viaVoice?: boolean;
  id: string;
  text: string;
  ts: number;
  confidence?: number | null;
  cited?: string[];
  artifacts?: Array<{
    artifactId: string;
    type: "html" | "svg";
    title: string;
    content: string;
  }>;
};

const CONTEXT_WINDOW = 40;

function historyPath(employeeId: string): string {
  return dataDir("employees", employeeId, "chat-history.jsonl");
}

export function loadChatHistory(employeeId: string): StoredMessage[] {
  const p = historyPath(employeeId);
  if (!fs.existsSync(p)) return [];
  return fs
    .readFileSync(p, "utf-8")
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try { return [JSON.parse(line) as StoredMessage]; }
      catch { return []; }
    });
}

export function appendChatMessage(employeeId: string, msg: StoredMessage): void {
  const p = historyPath(employeeId);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.appendFileSync(p, JSON.stringify(msg) + "\n", "utf-8");
}

/** Returns the last N messages formatted for the AI context history. */
export function getContextHistory(
  employeeId: string,
): Array<{ role: "user" | "assistant"; text: string }> {
  return loadChatHistory(employeeId)
    .slice(-CONTEXT_WINDOW)
    .filter((m) => m.text.trim().length > 0)
    .map((m) => ({ role: m.role === "user" ? "user" : "assistant", text: m.text }));
}

export type HistoryViewer = { id: string; role: string } | null;

/**
 * What one person may see of a twin's history: their own questions and the
 * answers to them. Owners and admins also see rows from before askedBy was
 * recorded. Nobody sees what a colleague asked.
 */
export function canSee(viewer: HistoryViewer, m: StoredMessage): boolean {
  const admin = !viewer || viewer.role === "owner" || viewer.role === "admin";
  return m.askedBy ? m.askedBy === viewer?.id : admin;
}

export function visibleTo(viewer: HistoryViewer, messages: StoredMessage[]): StoredMessage[] {
  return messages.filter((m) => canSee(viewer, m));
}

/** The viewer's latest Ask conversation with this twin. */
export function latestAskConversation(viewer: HistoryViewer, messages: StoredMessage[]): StoredMessage[] {
  const ask = visibleTo(viewer, messages).filter((m) => m.surface === "ask" && m.conversationId);
  const last = ask.at(-1)?.conversationId;
  return last ? ask.filter((m) => m.conversationId === last) : [];
}

/** Keep only the rows `keep` accepts (rewritten through a temp file). */
export function rewriteChatHistory(employeeId: string, keep: (m: StoredMessage) => boolean): void {
  const p = historyPath(employeeId);
  if (!fs.existsSync(p)) return;
  const rows = loadChatHistory(employeeId).filter(keep);
  const tmp = `${p}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""), "utf-8");
  fs.renameSync(tmp, p);
}

