// The switch end to end, no model calls: with EMPLOYEE001_CONNECTORS=emulator
// the real composio-client, intake routes and webhook verification run against
// the emulator.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectEmulatedEmployee } from "./state";
import { setWorldForTests } from "./world";
import { emailTrigger, signDelivery, slackTrigger } from "./webhook";
import { slackChannelId, slackTeamId, slackUserId } from "./ids";
import { ANA, BEN, testWorld } from "./test-world";

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "e001-emulator-switch-"));
const SECRET = "emulator-test-secret";
const saved = { ...process.env };

beforeAll(() => {
  process.env.EMPLOYEE001_HOME = HOME;
  process.env.EMPLOYEE001_CONNECTORS = "emulator";
  process.env.COMPOSIO_WEBHOOK_SECRET = SECRET;
  delete process.env.COMPOSIO_API_KEY;
  setWorldForTests(testWorld(Date.now()));
  const dir = path.join(HOME, "data", "employees", "ana");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "employee.json"), JSON.stringify({
    id: "ana", name: "Ana Lee", role: "Support Specialist", department: "Operations", synthetic: true,
    consent: { grantedAt: new Date().toISOString(), version: "1.0", scopes: ["data-collection", "integrations"] },
  }));
  connectEmulatedEmployee("ana", ANA, ["gmail", "slack"]);
});
afterAll(() => {
  process.env = saved;
  setWorldForTests(null);
  fs.rmSync(HOME, { recursive: true, force: true });
});

describe("EMPLOYEE001_CONNECTORS=emulator", () => {
  it("makes Composio look configured and the employee's toolkits ACTIVE", async () => {
    const { isComposioConfigured, refreshConnections } = await import("@/lib/composio-client");
    expect(isComposioConfigured()).toBe(true);
    const state = await refreshConnections("ana");
    expect(state.connections.gmail?.status).toBe("ACTIVE");
    expect(state.connections.slack).toMatchObject({ status: "ACTIVE", slackUserId: slackUserId(ANA) });
  });

  it("gives buildEmployeeMcpServer the emulated tools under the composio server name", async () => {
    const { buildEmployeeMcpServer } = await import("@/lib/composio-client");
    const server = await buildEmployeeMcpServer("ana");
    expect(server).toMatchObject({ type: "sdk", name: "composio" });
  });

  it("accepts a signed new-email delivery on /api/email/composio and queues a work item", async () => {
    const { POST } = await import("@/app/api/email/composio/route");
    const event = emailTrigger("ana", { from: "Sam Park <sam.park@willow-finch.test>", to: "ana.lee@acme-labs.test", subject: "Cutover date?", body: "Can you confirm Friday?" });
    const d = signDelivery(JSON.stringify(event), SECRET);
    const res = await POST(new Request("http://localhost/api/email/composio", { method: "POST", headers: d.headers, body: d.body }));
    expect(res.status).toBe(202);
    const { listWorkItems } = await import("@/lib/work-items");
    expect(listWorkItems().find((w) => w.type === "email")).toMatchObject({ assigneeEmployeeId: "ana", title: "Email: Cutover date?", payload: { from: "Sam Park <sam.park@willow-finch.test>", body: "Can you confirm Friday?" } });
    // The same delivery again is a replay.
    const again = await POST(new Request("http://localhost/api/email/composio", { method: "POST", headers: d.headers, body: d.body }));
    expect(again.status).toBe(401);
  });

  it("rejects a delivery signed with the wrong secret", async () => {
    const { POST } = await import("@/app/api/email/composio/route");
    const d = signDelivery(JSON.stringify(emailTrigger("ana", { from: "x <x@x.test>", to: "", subject: "s", body: "b" })), "wrong");
    expect((await POST(new Request("http://localhost/x", { method: "POST", headers: d.headers, body: d.body }))).status).toBe(401);
  });

  it("routes a Slack mention to the mentioned twin", async () => {
    const { POST } = await import("@/app/api/slack/composio/route");
    const event = slackTrigger("ana", { channel: slackChannelId("chan_1"), user: slackUserId(BEN), team: slackTeamId("acme-labs.test"), text: `<@${slackUserId(ANA)}> is the checklist done?` });
    const d = signDelivery(JSON.stringify(event), SECRET);
    const res = await POST(new Request("http://localhost/api/slack/composio", { method: "POST", headers: d.headers, body: d.body }));
    expect(res.status).toBe(202);
  });
});
