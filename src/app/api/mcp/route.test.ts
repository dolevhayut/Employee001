import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rows: Array<Record<string, unknown>> = [];
let appendOk = true;
vi.mock("@/lib/audit-log", () => ({
  appendAuditEntry: (row: Record<string, unknown>) => {
    if (appendOk) rows.push(row);
    return appendOk;
  },
}));

// Sessions only resolve for a person who still exists and can approve one.
vi.mock("@/lib/auth/store", () => ({ accountsEnabled: () => true, getUser: (id: string) => ({ id, role: "member" }) }));

import {
  approveUserCode,
  exchangeDeviceCode,
  issueDeviceCode,
  revokePersonSessions,
} from "@/lib/mcp-server/device-auth";
import { POST } from "./route";

const ENV_KEYS = [
  "EMPLOYEE001_HOME",
  "EMPLOYEE001_BIND",
  "EMPLOYEE001_MCP_TOKEN",
  "EMPLOYEE001_TOKEN",
  "EMPLOYEE001_MCP_PERSONAL_SIGNIN",
  "EMPLOYEE001_MCP_ALLOW_SHARED_TOKEN",
] as const;
const saved: Record<string, string | undefined> = {};
let home: string;

beforeEach(() => {
  rows.length = 0;
  appendOk = true;
  for (const key of ENV_KEYS) saved[key] = process.env[key];
  home = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-route-"));
  process.env.EMPLOYEE001_HOME = home;
  process.env.EMPLOYEE001_MCP_PERSONAL_SIGNIN = "1";
  delete process.env.EMPLOYEE001_BIND;
  delete process.env.EMPLOYEE001_MCP_ALLOW_SHARED_TOKEN;
  process.env.EMPLOYEE001_MCP_TOKEN = "shared-secret-token";
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  fs.rmSync(home, { recursive: true, force: true });
});

async function signIn(personId: string): Promise<string> {
  const issued = await issueDeviceCode();
  expect((await approveUserCode(issued.userCode, personId)).ok).toBe(true);
  const exchanged = await exchangeDeviceCode(issued.deviceCode);
  if (exchanged.status !== "approved") throw new Error("device code not approved");
  return exchanged.bearer;
}

function call(bearer: string | null, body: unknown = { jsonrpc: "2.0", id: 1, method: "tools/list" }) {
  return POST(
    new Request("http://localhost:3000/api/mcp", {
      method: "POST",
      headers: {
        host: "localhost:3000",
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      },
      body: JSON.stringify(body),
    }),
  );
}

const toolCall = (name: string) => ({
  jsonrpc: "2.0",
  id: 2,
  method: "tools/call",
  params: { name, arguments: {} },
});

describe("POST /api/mcp per-person identity and audit", () => {
  it("writes a distinct audit entry per person with who and tool", async () => {
    const ana = await signIn("person_ana");
    const ben = await signIn("person_ben");

    expect((await call(ana, toolCall("list_twins"))).status).toBe(200);
    expect((await call(ben, toolCall("search_org_brain"))).status).toBe(200);

    // The tool handler writes its own row too; ours are the ones that name a person.
    const executed = rows.filter((row) => row.verdict === "executed" && row.requesterId);
    expect(executed).toHaveLength(2);
    expect(executed.map((row) => row.requesterId)).toEqual(["person_ana", "person_ben"]);
    expect(executed.map((row) => row.bareName)).toEqual(["list_twins", "search_org_brain"]);
    expect(executed[0].runId).not.toBe(executed[1].runId);
    expect(executed[0].input).toEqual({ personId: "person_ana", tool: "list_twins" });
  });

  it("writes one entry per call in a batch", async () => {
    const ana = await signIn("person_ana");
    await call(ana, [toolCall("list_twins"), toolCall("get_twin_profile")]);
    expect(rows.map((row) => row.bareName)).toEqual(["list_twins", "get_twin_profile"]);
  });

  it("refuses the next request after the person's sessions are revoked", async () => {
    const ana = await signIn("person_ana");
    const ben = await signIn("person_ben");
    expect((await call(ana)).status).toBe(200);

    await revokePersonSessions("person_ana");

    const refused = await call(ana);
    expect(refused.status).toBe(401);
    expect(rows.at(-1)).toMatchObject({ verdict: "hard_blocked", requesterId: "unauthenticated" });
    // Someone else's session is untouched.
    expect((await call(ben)).status).toBe(200);
  });

  it("refuses the shared token once personal sign-in is on, unless an admin opts in", async () => {
    expect((await call("shared-secret-token")).status).toBe(401);
    process.env.EMPLOYEE001_MCP_ALLOW_SHARED_TOKEN = "1";
    expect((await call("shared-secret-token")).status).toBe(200);
    expect(rows.at(-1)).toMatchObject({ requesterId: "shared-token", verdict: "executed" });
    expect((await call("wrong-secret-token!")).status).toBe(401);
  });

  it("refuses a batch too big to audit in full instead of running unaudited calls", async () => {
    const ana = await signIn("person_ana");
    const batch = Array.from({ length: 51 }, () => toolCall("list_twins"));
    const before = rows.length;
    expect((await call(ana, batch)).status).toBe(413);
    expect(rows).toHaveLength(before);
  });

  function chunkedCall(bearer: string, chunks: string[], pulled: { count: number }) {
    const encoder = new TextEncoder();
    let i = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (i >= chunks.length) return controller.close();
        pulled.count++;
        controller.enqueue(encoder.encode(chunks[i++]));
      },
    });
    return POST(
      new Request("http://localhost:3000/api/mcp", {
        method: "POST",
        headers: {
          host: "localhost:3000",
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          authorization: `Bearer ${bearer}`,
        },
        body: stream,
        duplex: "half",
      } as RequestInit),
    );
  }

  it("caps a chunked body that has no Content-Length and stops reading it", async () => {
    const ana = await signIn("person_ana");
    const pulled = { count: 0 };
    const before = rows.length;
    const res = await chunkedCall(ana, Array.from({ length: 200 }, () => "x".repeat(100_000)), pulled);
    expect(res.status).toBe(413);
    expect(pulled.count).toBeLessThanOrEqual(15); // 1 MB cap / 100 KB chunks, plus stream read-ahead
    expect(rows).toHaveLength(before);
  });

  it("serves a small chunked body and audits it", async () => {
    const ana = await signIn("person_ana");
    const text = JSON.stringify(toolCall("list_twins"));
    const res = await chunkedCall(ana, [text.slice(0, 20), text.slice(20)], { count: 0 });
    expect(res.status).toBe(200);
    expect(rows.filter((r) => r.requesterId === "person_ana" && r.bareName === "list_twins")).toHaveLength(1);
  });

  it("does not honour a personal session while personal sign-in is off on an exposed bind", async () => {
    const ana = await signIn("person_ana");
    process.env.EMPLOYEE001_MCP_PERSONAL_SIGNIN = "0";
    process.env.EMPLOYEE001_BIND = "0.0.0.0";
    expect((await call(ana)).status).toBe(401);
  });

  it("refuses a request with no bearer when personal sign-in is on", async () => {
    expect((await call(null)).status).toBe(401);
  });

  it("does not serve a personal request it cannot audit", async () => {
    const ana = await signIn("person_ana");
    appendOk = false;
    expect((await call(ana)).status).toBe(503);
  });

  it("keeps the shared-token check on a non-loopback bind with personal sign-in off", async () => {
    process.env.EMPLOYEE001_MCP_PERSONAL_SIGNIN = "0";
    process.env.EMPLOYEE001_BIND = "0.0.0.0";
    expect((await call("shared-secret-token")).status).toBe(200);
    expect((await call("nope")).status).toBe(401);
    expect((await call(null)).status).toBe(401);
  });

  it("leaves a loopback request without a token working when personal sign-in is off", async () => {
    process.env.EMPLOYEE001_MCP_PERSONAL_SIGNIN = "0";
    expect((await call(null)).status).toBe(200);
    expect(rows.at(-1)).toMatchObject({ requesterId: "unauthenticated", verdict: "executed" });
  });
});
