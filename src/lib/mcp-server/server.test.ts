import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildToolConfig } from "@/lib/council-runner";
import { checkLocalRequest } from "./guard";
import { buildPublicMcpServer } from "./server";

describe("public MCP guard", () => {
  it("accepts loopback host/origin and rejects rebinding inputs", async () => {
    const local = new Request("http://localhost/api/mcp", { headers: { host: "localhost:3000", origin: "http://localhost:3000" } });
    const evilHost = new Request("http://localhost/api/mcp", { headers: { host: "evil.test" } });
    const evilOrigin = new Request("http://localhost/api/mcp", { headers: { host: "127.0.0.1", origin: "https://evil.test" } });
    expect(checkLocalRequest(local)).toBeNull();
    expect(await checkLocalRequest(evilHost)?.json()).toMatchObject({ error: { code: -32003, message: "forbidden host" } });
    expect(await checkLocalRequest(evilOrigin)?.json()).toMatchObject({ error: { code: -32003, message: "forbidden origin" } });
  });
});

describe("answer-only runner tools", () => {
  it("permits only local reads and org-brain retrieval", () => {
    expect(buildToolConfig({ answerOnly: true })).toMatchObject({ allowedTools: ["Read", "Glob", "Grep", "mcp__org_brain__search_org_brain"], disallowedTools: ["AskUserQuestion", "Write", "WebSearch", "WebFetch", "Task", "TodoWrite"] });
  });
});

describe("public MCP server", () => {
  it("publishes the seven contract tools", async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = buildPublicMcpServer(); const client = new Client({ name: "test", version: "1" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name).sort()).toEqual(["ask_twin", "get_team_meeting", "get_twin_profile", "list_pending_approvals", "list_team_meetings", "list_twins", "search_org_brain"]);
    await Promise.all([client.close(), server.close()]);
  });
});
