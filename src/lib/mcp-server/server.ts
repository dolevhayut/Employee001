import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import pkg from "../../../package.json";
import { executeTool, type ToolName } from "./tools";

type ToolDefinition = {
  name: ToolName;
  description: string;
  inputSchema: z.ZodType;
  enabled?: boolean;
};

export function isLoopbackBind(bind: string | undefined): boolean {
  // Keep this in sync with proxy.ts without importing middleware into the route.
  if (!bind) return true;
  const value = bind.trim();
  return (
    value === "" ||
    value === "127.0.0.1" ||
    value === "::1" ||
    value === "localhost"
  );
}

const noArgs = z.object({}).strict();
const profile = z.object({
  twinId: z.string(),
  // Validate names in the handler so invalid files return the public bad_request shape.
  files: z.array(z.string()).optional(),
});
const search = z.object({
  query: z.string().min(2).max(200),
  source: z.string().optional(),
  file: z.string().optional(),
  limit: z.number().int().min(1).max(20).optional(),
});
const meeting = z.object({ meetingId: z.string() });
const ask = z.object({
  twinId: z.string(),
  question: z.string().min(1).max(4000),
});

function toolDefinitions(): ToolDefinition[] {
  return [
    {
      name: "list_twins",
      description:
        "Use this to find colleagues and their ownership before you build or ask a question.",
      inputSchema: noArgs,
    },
    {
      name: "get_twin_profile",
      description:
        "Use this to read a colleague's grounded profile and decisions before you build.",
      inputSchema: profile,
    },
    {
      name: "search_org_brain",
      description:
        "Use this first to find what colleagues decided or own before you build; it searches local profiles and the org brain.",
      inputSchema: search,
    },
    {
      name: "list_pending_approvals",
      description:
        "Use this to see pending Employee001 approvals without exposing raw tool input.",
      inputSchema: noArgs,
    },
    {
      name: "list_team_meetings",
      description:
        "Use this to list active in-memory team meetings for this Employee001 process; meetings reset on restart.",
      inputSchema: noArgs,
    },
    {
      name: "get_team_meeting",
      description:
        "Use this to inspect an active in-memory team meeting, its latest transcript, and shared files.",
      inputSchema: meeting,
    },
    {
      name: "ask_twin",
      description:
        "Use search_org_brain first. Ask a ready colleague for an answer when retrieval is insufficient; this costs money (up to $0.50 per call) and takes 10–60 seconds.",
      inputSchema: ask,
      enabled: process.env.EMPLOYEE001_MCP_ASK_TWIN !== "off",
    },
  ];
}

export function buildPublicMcpServer(): McpServer {
  const server = new McpServer({
    name: "employee001",
    version: process.env.npm_package_version ?? pkg.version,
  });
  for (const definition of toolDefinitions()) {
    if (definition.enabled === false) continue;
    server.registerTool(definition.name, definition, (args) =>
      executeTool(definition.name, args as Record<string, unknown>),
    );
  }
  return server;
}
