import fs from "fs";
import path from "path";
import { getComposio, composioUserIdFor, isComposioConfigured, readState } from "@/lib/composio-client";
import { loadEmployeesFromDisk } from "@/lib/employees-disk";
import { enqueueWorkItem } from "@/lib/work-items";

// Inbound email → WorkItem. Polls each employee's connected Gmail through
// the SAME Composio connection the twin already uses for outbound — no new
// provider, no new credentials, no webhook endpoint to expose locally.
//
// Safety comes from the queue, not the poller: idempotencyKey is the Gmail
// message id, so overlapping polls, restarts, and re-reads of the same
// window can never enqueue a message twice. The lookback window (2 days)
// is well inside the queue's 7-day terminal-item retention, so dedupe
// records always outlive the window they guard.

const POLL_INTERVAL_MS = 5 * 60 * 1000; // per-employee floor between polls
const LOOKBACK_QUERY = "in:inbox newer_than:2d";
const MAX_MESSAGES_PER_POLL = 10;

const STATE_FILE = () => path.join(process.cwd(), "data", "email-poll.json");

type PollState = Record<string, { lastPollAt: string; lastError?: string }>;

function loadState(): PollState {
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_FILE(), "utf8"));
    return raw && typeof raw === "object" ? (raw as PollState) : {};
  } catch {
    return {};
  }
}

function saveState(state: PollState): void {
  const file = STATE_FILE();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, file);
}

// Composio's GMAIL_FETCH_EMAILS response shape has shifted across SDK
// versions — normalize defensively instead of trusting one layout.
type RawMessage = Record<string, unknown>;

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function extractMessages(data: unknown): RawMessage[] {
  if (!data || typeof data !== "object") return [];
  const d = data as Record<string, unknown>;
  for (const key of ["messages", "response_data", "items"]) {
    const v = d[key];
    if (Array.isArray(v)) return v as RawMessage[];
    if (v && typeof v === "object") {
      const inner = (v as Record<string, unknown>).messages;
      if (Array.isArray(inner)) return inner as RawMessage[];
    }
  }
  return [];
}

function normalizeMessage(m: RawMessage): {
  messageId: string;
  threadId?: string;
  from?: string;
  subject?: string;
  date?: string;
  body?: string;
} | null {
  const messageId = str(m.messageId) ?? str(m.id);
  if (!messageId) return null;
  return {
    messageId,
    threadId: str(m.threadId) ?? str(m.thread_id),
    from: str(m.sender) ?? str(m.from),
    subject: str(m.subject),
    date: str(m.messageTimestamp) ?? str(m.date) ?? str(m.internalDate),
    body:
      str(m.messageText) ??
      str(m.snippet) ??
      str(m.preview) ??
      str((m.payload as Record<string, unknown> | undefined)?.body as unknown),
  };
}

/**
 * One poll pass over every employee with an ACTIVE Gmail connection.
 * Fire-and-forget from the scheduler tick; all failures are recorded in
 * poll state, never thrown.
 */
export async function pollEmailInboxes(): Promise<void> {
  if (!isComposioConfigured()) return;

  const state = loadState();
  const now = Date.now();
  const employees = await loadEmployeesFromDisk();

  for (const employee of employees) {
    const last = state[employee.id]?.lastPollAt;
    if (last && now - new Date(last).getTime() < POLL_INTERVAL_MS) continue;

    // Only employees whose Gmail is actually connected.
    let gmailActive = false;
    try {
      const cs = await readState(employee.id);
      gmailActive = cs.connections["gmail"]?.status === "ACTIVE";
    } catch {
      /* treat as not connected */
    }
    if (!gmailActive) continue;

    state[employee.id] = { lastPollAt: new Date().toISOString() };
    try {
      const composio = getComposio();
      const result = (await composio.tools.execute("GMAIL_FETCH_EMAILS", {
        userId: composioUserIdFor(employee.id),
        arguments: {
          query: LOOKBACK_QUERY,
          max_results: MAX_MESSAGES_PER_POLL,
        },
      })) as { data?: unknown; error?: unknown; successful?: boolean };

      if (result?.successful === false) {
        state[employee.id].lastError = String(result.error ?? "fetch failed").slice(0, 200);
        continue;
      }

      let enqueued = 0;
      for (const raw of extractMessages(result?.data)) {
        const msg = normalizeMessage(raw);
        if (!msg) continue;
        const { deduped } = enqueueWorkItem({
          type: "email",
          assigneeEmployeeId: employee.id,
          title: msg.subject ? `Email: ${msg.subject}` : "Email (no subject)",
          payload: msg,
          idempotencyKey: `email:${msg.messageId}`,
        });
        if (!deduped) enqueued++;
      }
      if (enqueued > 0) {
        console.log(`[email-poller] ${employee.id}: enqueued ${enqueued} new email work item(s)`);
      }
    } catch (err) {
      state[employee.id].lastError = (err instanceof Error ? err.message : String(err)).slice(0, 200);
    }
  }

  saveState(state);
}
