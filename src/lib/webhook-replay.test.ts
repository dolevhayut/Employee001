import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let home: string;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "e001-replay-"));
  process.env.EMPLOYEE001_HOME = home;
  vi.resetModules();
});
afterEach(() => {
  delete process.env.EMPLOYEE001_HOME;
  fs.rmSync(home, { recursive: true, force: true });
});

const NOW = 1_800_000_000_000;
const ts = (offsetSec = 0) => String(Math.floor(NOW / 1000) + offsetSec);

describe("webhook replay protection", () => {
  it("accepts a fresh delivery once and rejects the replay", async () => {
    const { acceptWebhookOnce } = await import("./webhook-replay");
    expect(acceptWebhookOnce("composio-slack", "msg_1", ts(), NOW)).toEqual({ ok: true });
    expect(acceptWebhookOnce("composio-slack", "msg_1", ts(), NOW + 1000)).toEqual({ ok: false, reason: "replayed" });
    // Same id on another endpoint is a different delivery.
    expect(acceptWebhookOnce("composio-email", "msg_1", ts(), NOW)).toEqual({ ok: true });
  });

  it("rejects timestamps outside five minutes either way, and garbage", async () => {
    const { acceptWebhookOnce } = await import("./webhook-replay");
    expect(acceptWebhookOnce("s", "a", ts(-301), NOW)).toEqual({ ok: false, reason: "stale_timestamp" });
    expect(acceptWebhookOnce("s", "b", ts(301), NOW)).toEqual({ ok: false, reason: "stale_timestamp" });
    expect(acceptWebhookOnce("s", "c", "yesterday", NOW)).toEqual({ ok: false, reason: "bad_timestamp" });
    expect(acceptWebhookOnce("s", "d", String(NOW), NOW)).toEqual({ ok: true }); // milliseconds
  });

  it("forgets nonces after the retention window", async () => {
    const { acceptWebhookOnce } = await import("./webhook-replay");
    acceptWebhookOnce("s", "old", ts(), NOW);
    const later = NOW + 11 * 60_000;
    expect(acceptWebhookOnce("s", "old", String(Math.floor(later / 1000)), later)).toEqual({ ok: true });
  });

  it("rejects a replayed, validly signed Composio delivery end to end", async () => {
    const { verifyComposioWebhook } = await import("./email-intake-trigger");
    const verifier = async () => ({ payload: { ok: true } });
    const input = { payload: "{}", signature: "v1,sig", id: "msg_9", timestamp: ts(), secret: "s", scope: "composio-slack", now: NOW };
    expect(await verifyComposioWebhook(input, verifier)).toEqual({ payload: { ok: true } });
    expect(await verifyComposioWebhook(input, verifier)).toBeNull();
    expect(await verifyComposioWebhook({ ...input, id: "msg_10", timestamp: ts(-900) }, verifier)).toBeNull();
  });
});
