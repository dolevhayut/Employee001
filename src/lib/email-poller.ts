import fs from "fs";
import path from "path";
import { getComposio, composioUserIdFor, isComposioConfigured, readState } from "@/lib/composio-client";
import { loadEmployeesFromDisk } from "@/lib/employees-disk";
import { dataDir } from "@/lib/app-home";
import { extractEmailMessages, gmailQuerySince, ingestEmailMessage, normalizeEmailMessage as normalizeSharedEmailMessage } from "@/lib/email-intake";
import { emailPollIntervalMs, emailTriggerFor, ensureEmailTrigger } from "@/lib/email-intake-trigger";

// Inbound email → WorkItem. Polls each employee's connected Gmail through
// the SAME Composio connection the twin already uses for outbound — no new
// provider, no new credentials, no webhook endpoint to expose locally.
//
// Safety comes from the queue, not the poller: idempotencyKey is the Gmail
// message id, so overlapping polls, restarts, and re-reads of the same
// window can never enqueue a message twice. The lookback window (2 days)
// is well inside the queue's 7-day terminal-item retention, so dedupe
// records always outlive the window they guard.

const MAX_MESSAGES_PER_POLL = 25;

const STATE_FILE = () => dataDir("email-poll.json");

type PollState = Record<string, { lastPollAt: string; cursor?: string; lastError?: string }>;

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
    // Only employees whose Gmail is actually connected.
    let gmailActive = false;
    try {
      const cs = await readState(employee.id);
      gmailActive = cs.connections["gmail"]?.status === "ACTIVE";
    } catch {
      /* treat as not connected */
    }
    if (!gmailActive) continue;

    // A public, signed URL gets an immediate push path; the poller remains a
    // reconciliation safety net. Without one, preserve local-first 5-minute polling.
    let pushArmed = Boolean(emailTriggerFor(employee.id));
    if (!pushArmed && publicPushConfigured()) pushArmed = (await ensureEmailTrigger(employee.id)).armed;
    const previous = state[employee.id];
    if (previous?.lastPollAt && now - new Date(previous.lastPollAt).getTime() < emailPollIntervalMs(pushArmed)) continue;

    state[employee.id] = { lastPollAt: new Date().toISOString(), cursor: previous?.cursor };
    try {
      const composio = getComposio();
      const result = (await composio.tools.execute("GMAIL_FETCH_EMAILS", {
        userId: composioUserIdFor(employee.id),
        arguments: {
          query: gmailQuerySince(previous?.cursor),
          max_results: MAX_MESSAGES_PER_POLL,
        },
      })) as { data?: unknown; error?: unknown; successful?: boolean };

      if (result?.successful === false) {
        state[employee.id].lastError = String(result.error ?? "fetch failed").slice(0, 200);
        continue;
      }

      let enqueued = 0;
      for (const raw of extractEmailMessages(result?.data)) {
        const msg = normalizeSharedEmailMessage(raw);
        if (!msg) continue;
        const { deduped } = ingestEmailMessage(employee.id, msg);
        if (!deduped) enqueued++;
      }
      // Advance only after successful ingestion. A crash causes a safe, deduped rescan.
      state[employee.id].cursor = new Date(now).toISOString();
      if (enqueued > 0) {
        console.log(`[email-poller] ${employee.id}: enqueued ${enqueued} new email work item(s)`);
      }
    } catch (err) {
      state[employee.id].lastError = (err instanceof Error ? err.message : String(err)).slice(0, 200);
    }
  }

  saveState(state);
}

function publicPushConfigured(): boolean {
  return Boolean(process.env.COMPOSIO_WEBHOOK_SECRET && (process.env.EMPLOYEE001_PUBLIC_URL || process.env.APP_URL));
}
