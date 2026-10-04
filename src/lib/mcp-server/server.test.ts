import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  appendAuditEntry: vi.fn(),
  isUnderBudget: vi.fn(),
  listMeetings: vi.fn(),
  listPendingApprovals: vi.fn(),
  listSharedFiles: vi.fn(),
  loadEmployeesFromDisk: vi.fn(),
  getMeeting: vi.fn(),
  readEmployeeFile: vi.fn(),
  recordSpend: vi.fn(),
  runSingleTwin: vi.fn(),
  searchOrgBrain: vi.fn(),
}));

vi.mock("@/lib/employees-disk", () => ({
  loadEmployeesFromDisk: m.loadEmployeesFromDisk,
}));
vi.mock("@/lib/employees-files", () => ({
  readEmployeeFile: m.readEmployeeFile,
}));
vi.mock("@/lib/org-brain-search", () => ({ searchOrgBrain: m.searchOrgBrain }));
vi.mock("@/lib/approval-bus", () => ({
  listPendingApprovals: m.listPendingApprovals,
}));
vi.mock("@/lib/meeting-store", () => ({
  getMeeting: m.getMeeting,
  listMeetings: m.listMeetings,
  listSharedFiles: m.listSharedFiles,
  renderTranscriptForPrompt: (
    turns: Array<{ kind: string; text: string; employeeName?: string }>,
  ) =>
    turns.length
      ? turns
          .map((turn) =>
            turn.kind === "ceo"
              ? `CEO: ${turn.text}`
              : `${turn.employeeName}: ${turn.text}`,
          )
          .join("\n\n")
      : "(meeting just started — no prior turns)",
}));
vi.mock("@/lib/council-runner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/council-runner")>()),
  runSingleTwin: m.runSingleTwin,
}));
vi.mock("@/lib/twin-budget", () => ({
  isUnderBudget: m.isUnderBudget,
  recordSpend: m.recordSpend,
}));
vi.mock("@/lib/audit-log", () => ({ appendAuditEntry: m.appendAuditEntry }));

import { GET, POST } from "@/app/api/mcp/route";
import { buildToolConfig } from "@/lib/council-runner";
import { checkLocalRequest } from "./guard";
import { buildPublicMcpServer } from "./server";

const ready = {
  id: "maya",
  name: "Maya Chen",
  firstName: "Maya",
  role: "Product",
  department: "Product",
  twinStatus: "ready",
};

async function connect() {
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const server = buildPublicMcpServer();
  const client = new Client({ name: "test", version: "1" });
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  return { client, server };
}

async function call(name: string, args: Record<string, unknown>) {
  const { client, server } = await connect();
  try {
    return await client.callTool({ name, arguments: args });
  } finally {
    await Promise.all([client.close(), server.close()]);
  }
}

function json(result: unknown) {
  const response = result as {
    content: Array<{ type: string; text?: string }>;
  };
  const content = response.content.find((item) => item.type === "text");
  return JSON.parse(content?.text ?? "{}") as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  delete (
    globalThis as typeof globalThis & { __e001McpAskTimestamps?: number[] }
  ).__e001McpAskTimestamps;
  delete (globalThis as typeof globalThis & { __e001McpInFlight?: Set<string> })
    .__e001McpInFlight;
  delete process.env.EMPLOYEE001_MCP_ASK_TWIN;
  delete process.env.EMPLOYEE001_BIND;
  delete process.env.EMPLOYEE001_TOKEN;
  m.loadEmployeesFromDisk.mockResolvedValue([ready]);
  m.readEmployeeFile.mockReturnValue("profile");
  m.searchOrgBrain.mockResolvedValue([
    {
      source: "maya",
      file: "DECISIONS.md",
      section: "Roadmap",
      snippet: "ship it",
      score: 4,
    },
  ]);
  m.listPendingApprovals.mockReturnValue([]);
  m.listMeetings.mockReturnValue([]);
  m.getMeeting.mockReturnValue(undefined);
  m.listSharedFiles.mockReturnValue([]);
  m.isUnderBudget.mockReturnValue(true);
  m.runSingleTwin.mockResolvedValue("Grounded answer");
});
afterEach(() => vi.useRealTimers());

describe("guard and runner policy", () => {
  it("blocks rebinding and retains the real answer-only runner config", async () => {
    expect(
      checkLocalRequest(
        new Request("http://localhost", {
          headers: { host: "localhost:3000", origin: "http://localhost:3000" },
        }),
      ),
    ).toBeNull();
    expect(
      await checkLocalRequest(
        new Request("http://localhost", { headers: { host: "evil.test" } }),
      )?.json(),
    ).toMatchObject({ error: { code: -32003 } });
    expect(buildToolConfig({ answerOnly: true })).toMatchObject({
      allowedTools: [
        "Read",
        "Glob",
        "Grep",
        "mcp__org_brain__search_org_brain",
      ],
      disallowedTools: [
        "AskUserQuestion",
        "Write",
        "WebSearch",
        "WebFetch",
        "Task",
        "TodoWrite",
      ],
    });
  });
});

describe("MCP tools", () => {
  it("lists seven tools, or six when ask_twin is off", async () => {
    let connection = await connect();
    expect((await connection.client.listTools()).tools).toHaveLength(7);
    await Promise.all([connection.client.close(), connection.server.close()]);
    process.env.EMPLOYEE001_MCP_ASK_TWIN = "off";
    connection = await connect();
    expect(
      (await connection.client.listTools()).tools
        .map((tool) => tool.name)
        .sort(),
    ).toEqual([
      "get_team_meeting",
      "get_twin_profile",
      "list_pending_approvals",
      "list_team_meetings",
      "list_twins",
      "search_org_brain",
    ]);
    await Promise.all([connection.client.close(), connection.server.close()]);
  });

  it("returns the specified JSON shapes for every contract tool", async () => {
    m.listPendingApprovals.mockReturnValue([
      {
        approvalId: "apr_1",
        employeeId: "maya",
        toolName: "send_email",
        reason: "Send launch",
        input: {},
        surface: "chat",
        createdAt: 1,
      },
    ]);
    const meeting = {
      id: "mtg_1",
      participantIds: ["maya"],
      transcript: [{ kind: "ceo", text: "Hi", ts: 1 }],
      createdAt: 1,
      updatedAt: 2,
    };
    m.listMeetings.mockReturnValue([meeting]);
    m.getMeeting.mockReturnValue(meeting);
    m.listSharedFiles.mockReturnValue([
      { filename: "notes.md", summary: "Notes", sharedByName: "Maya" },
    ]);
    expect(json(await call("list_twins", {}))[0]).toMatchObject({
      id: "maya",
      status: "ready",
    });
    expect(
      json(await call("get_twin_profile", { twinId: "maya" })),
    ).toMatchObject({ id: "maya", files: { "EXPERTISE.md": "profile" } });
    expect(
      json(await call("search_org_brain", { query: "roadmap" }))[0],
    ).toMatchObject({ heading: "Roadmap", snippet: "ship it" });
    expect(json(await call("list_pending_approvals", {}))[0]).toMatchObject({
      id: "apr_1",
      summary: "Send launch",
    });
    expect(json(await call("list_team_meetings", {}))[0]).toMatchObject({
      id: "mtg_1",
      turns: 1,
    });
    expect(
      json(await call("get_team_meeting", { meetingId: "mtg_1" })),
    ).toMatchObject({
      transcript: "CEO: Hi",
      sharedFiles: [{ name: "notes.md", author: "Maya" }],
    });
    const answer = (await call("ask_twin", {
      twinId: "maya",
      question: "What next?",
    })) as { content: Array<{ text?: string }> };
    expect(answer.content[0].text).toContain("Maya (Product) says");
  });

  it("handles profile errors, size caps, and private approval input", async () => {
    expect(
      json(await call("get_twin_profile", { twinId: "missing" })),
    ).toMatchObject({ error: "not_found" });
    expect(
      json(
        await call("get_twin_profile", { twinId: "maya", files: ["bad.md"] }),
      ),
    ).toMatchObject({ error: "bad_request" });
    m.readEmployeeFile.mockReturnValue("x".repeat(20 * 1024));
    const profile = json(
      await call("get_twin_profile", {
        twinId: "maya",
        files: ["EXPERTISE.md"],
      }),
    );
    expect((profile.files as Record<string, string>)["EXPERTISE.md"]).toMatch(
      /\[truncated\]$/,
    );
    m.listPendingApprovals.mockReturnValue([
      {
        approvalId: "apr",
        employeeId: "maya",
        toolName: "send_email",
        reason: "",
        input: { body: "secret" },
        surface: "chat",
        createdAt: 1,
      },
    ]);
    const result = await call("list_pending_approvals", {});
    expect(JSON.stringify(result)).not.toContain("secret");
    expect((json(result)[0] as Record<string, unknown>).summary).toBe(
      "send_email awaiting approval",
    );
  });

  it("truncates meetings by actual oldest-turn count and retains the newest", async () => {
    const transcript = Array.from({ length: 4 }, (_, index) => ({
      kind: "ceo",
      text: `${index === 3 ? "newest" : "old"}-${"x".repeat(22_000)}`,
      ts: index,
    }));
    const largeMeeting = {
      id: "large",
      participantIds: ["maya"],
      transcript,
      createdAt: 1,
      updatedAt: 2,
    };
    m.getMeeting.mockImplementation((id) =>
      id === "large" ? largeMeeting : undefined,
    );
    expect(
      json(await call("get_team_meeting", { meetingId: "missing" })),
    ).toMatchObject({ error: "not_found" });
    const large = json(await call("get_team_meeting", { meetingId: "large" }));
    expect(large).toMatchObject({ truncated: true, turnsOmitted: 2 });
    expect(large.transcript).toContain("newest");
  });
});

describe("ask_twin execution and audit", () => {
  it("enforces not-ready, budget, and rolling-hour guards", async () => {
    m.loadEmployeesFromDisk.mockResolvedValue([
      { ...ready, twinStatus: "paused" },
    ]);
    expect(
      json(await call("ask_twin", { twinId: "maya", question: "q" })),
    ).toMatchObject({ error: "not_ready" });
    m.loadEmployeesFromDisk.mockResolvedValue([ready]);
    m.isUnderBudget.mockReturnValue(false);
    expect(
      json(await call("ask_twin", { twinId: "maya", question: "q" })),
    ).toMatchObject({ error: "over_budget" });
    expect(m.runSingleTwin).not.toHaveBeenCalled();
    m.isUnderBudget.mockReturnValue(true);
    vi.useFakeTimers();
    for (let index = 0; index < 20; index++)
      await call("ask_twin", { twinId: "maya", question: `q${index}` });
    expect(
      json(await call("ask_twin", { twinId: "maya", question: "blocked" })),
    ).toMatchObject({ error: "rate_limited" });
  });

  it("serializes a twin, passes safe options, and spends only once", async () => {
    let resolve!: (answer: string) => void;
    m.runSingleTwin.mockImplementationOnce((_employee, _prompt, onEvent) => {
      onEvent({ type: "employee_done", costUsd: 0.12 });
      onEvent({ type: "employee_error", costUsd: 0.07 });
      return new Promise((done) => {
        resolve = done;
      });
    });
    const first = call("ask_twin", { twinId: "maya", question: "one" });
    await vi.waitFor(() => expect(m.runSingleTwin).toHaveBeenCalledOnce());
    expect(
      json(await call("ask_twin", { twinId: "maya", question: "two" })),
    ).toMatchObject({ error: "busy" });
    resolve("answer");
    await first;
    expect(m.recordSpend).toHaveBeenCalledTimes(1);
    expect(m.recordSpend).toHaveBeenCalledWith("maya", 0.12);
    expect(m.runSingleTwin.mock.calls[0][4]).toMatchObject({
      consultMode: true,
      answerOnly: true,
      maxBudgetUsd: 0.5,
    });
    expect(m.runSingleTwin.mock.calls[0][4]).not.toHaveProperty(
      "consultContext",
    );
  });

  it("charges error events and appends one sanitized audit row per call", async () => {
    m.runSingleTwin.mockImplementationOnce((_employee, _prompt, onEvent) => {
      onEvent({ type: "employee_error", costUsd: 0.07 });
      return Promise.resolve("answer");
    });
    const question = "q".repeat(130);
    await call("ask_twin", { twinId: "maya", question });
    expect(m.recordSpend).toHaveBeenCalledWith("maya", 0.07);
    expect(m.appendAuditEntry.mock.calls.at(-1)?.[0]).toMatchObject({
      verdict: "executed",
      durationMs: expect.any(Number),
      input: { twinId: "maya", question: question.slice(0, 120) },
    });
    await call("get_twin_profile", { twinId: "missing" });
    expect(m.appendAuditEntry.mock.calls.at(-1)?.[0]).toMatchObject({
      verdict: "hard_blocked",
      blockReason: "not_found",
    });
  });
});

describe("MCP route", () => {
  it("requires a token on non-loopback binds, accepts LAN Hosts, and serves loopback tools/list", async () => {
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {},
    });
    process.env.EMPLOYEE001_BIND = "0.0.0.0";
    process.env.EMPLOYEE001_TOKEN = "lan-token";
    let response = await POST(
      new Request("http://lan-hostname.local/api/mcp", {
        method: "POST",
        headers: {
          host: "lan-hostname.local",
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body,
      }),
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: -32004, message: "missing or invalid token" } });
    response = await POST(
      new Request("http://lan-hostname.local/api/mcp", {
        method: "POST",
        headers: {
          host: "lan-hostname.local",
          authorization: "Bearer lan-token",
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body,
      }),
    );
    expect(response.status).toBe(200);
    expect(((await response.json()) as { result: { tools: unknown[] } }).result.tools).toHaveLength(7);
    response = await POST(
      new Request("http://lan-hostname.local/api/mcp", {
        method: "POST",
        headers: {
          host: "lan-hostname.local",
          origin: "https://evil.example",
          authorization: "Bearer lan-token",
        },
        body,
      }),
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: -32003, message: "forbidden origin" } });
    response = await POST(
      new Request("http://lan-hostname.local:3000/api/mcp", {
        method: "POST",
        headers: {
          host: "lan-hostname.local:3000",
          origin: "http://lan-hostname.local:8080",
          authorization: "Bearer lan-token",
        },
        body,
      }),
    );
    expect(response.status).toBe(403);
    delete process.env.EMPLOYEE001_BIND;
    response = await POST(
      new Request("http://evil.test/api/mcp", {
        method: "POST",
        headers: { host: "evil.test" },
        body,
      }),
    );
    expect(await response.json()).toMatchObject({ error: { code: -32003 } });
    response = await POST(
      new Request("http://localhost/api/mcp", {
        method: "POST",
        headers: {
          host: "localhost",
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body,
      }),
    );
    expect(response.status).toBe(200);
    expect(
      ((await response.json()) as { result: { tools: unknown[] } }).result
        .tools,
    ).toHaveLength(7);
    expect((await GET()).status).toBe(405);
  });
});
