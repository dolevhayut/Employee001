import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import pkg from "../../../package.json";
import { executeTool } from "./tools";

export function isLoopbackBind(bind: string | undefined): boolean {
  // Keep semantics in sync with src/proxy.ts without importing middleware.
  if (!bind) return true;
  const value = bind.trim();
  return value === "" || value === "127.0.0.1" || value === "::1" || value === "localhost";
}

const noArgs = z.object({}).strict();
const profile = z.object({ twinId: z.string(), files: z.array(z.enum(["EXPERTISE.md", "TONE.md", "CONTEXT.md", "DECISIONS.md", "PREFERENCES.md", "PEOPLE.md", "PROJECTS.md", "BOUNDARIES.md", "EMPLOYMENT.md"])).optional() });
const search = z.object({ query: z.string().min(2).max(200), source: z.string().optional(), file: z.string().optional(), limit: z.number().int().min(1).max(20).optional() });
const meeting = z.object({ meetingId: z.string() });
const ask = z.object({ twinId: z.string(), question: z.string().min(1).max(4000) });

export function buildPublicMcpServer(): McpServer {
  const server = new McpServer({ name: "employee001", version: process.env.npm_package_version ?? pkg.version });
  const register = (name: string, description: string, inputSchema: z.ZodType, enabled = true) => {
    if (enabled) server.registerTool(name, { description, inputSchema }, (args) => executeTool(name, args as Record<string, unknown>));
  };
  register("list_twins", "Use this to find colleagues and their ownership before you build or ask a question.", noArgs);
  register("get_twin_profile", "Use this to read a colleague's grounded profile and decisions before you build.", profile);
  register("search_org_brain", "Use this first to find what colleagues decided or own before you build; it searches local profiles and the org brain.", search);
  register("list_pending_approvals", "Use this to see pending Employee001 approvals without exposing raw tool input.", noArgs);
  register("list_team_meetings", "Use this to list active in-memory team meetings for this Employee001 process; meetings reset on restart.", noArgs);
  register("get_team_meeting", "Use this to inspect an active in-memory team meeting, its latest transcript, and shared files.", meeting);
  register("ask_twin", "Use search_org_brain first. Ask a ready colleague for an answer when retrieval is insufficient; this costs money (up to $0.50 per call) and takes 10–60 seconds.", ask, process.env.EMPLOYEE001_MCP_ASK_TWIN !== "off");
  return server;
}
