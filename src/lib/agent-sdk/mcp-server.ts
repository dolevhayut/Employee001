// In-process MCP server factory. Mirrors the Claude Agent SDK's
// `createSdkMcpServer` + `tool` surface so existing builders
// (artifacts-mcp.ts, org-brain-mcp.ts, meeting-scratch-mcp.ts, graph-mcp.ts)
// register tools identically.

import { z } from "zod";
import type {
  McpSdkServerConfigWithInstance,
  McpToolDefinition,
  McpToolHandler,
} from "./types";

export function tool<T extends z.ZodRawShape>(
  name: string,
  description: string,
  inputShape: T,
  handler: (input: z.infer<z.ZodObject<T>>) => Promise<
    Awaited<ReturnType<McpToolHandler>>
  >
): McpToolDefinition {
  const inputSchema = z.object(inputShape);
  return {
    name,
    description,
    inputSchema,
    handler: async (rawInput) => {
      try {
        const parsed = inputSchema.parse(rawInput);
        // narrow back to T's inferred shape for the user handler
        return handler(parsed as z.infer<z.ZodObject<T>>);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Invalid tool input: ${message}` }],
          isError: true,
        };
      }
    },
  };
}

export function createSdkMcpServer(args: {
  name: string;
  version?: string;
  tools: McpToolDefinition[];
}): McpSdkServerConfigWithInstance {
  return {
    type: "sdk",
    name: args.name,
    version: args.version ?? "1.0.0",
    instance: { tools: args.tools },
  };
}
