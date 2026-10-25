import "server-only";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { EmployeeWithTwin } from "@/lib/employees";
import { requestConnection } from "@/lib/connection-requests";
import { loadLifecycle } from "@/lib/twin-lifecycle";

/** In-process MCP tool for asking an admin to connect an unavailable system. */
export function buildConnectionRequestMcpServer(employee: EmployeeWithTwin) {
  return createSdkMcpServer({
    name: "connection_requests",
    version: "1.0.0",
    tools: [
      tool(
        "request_connection",
        "Ask the admin to connect a system or add an MCP server you cannot reach. This writes only to the local Inbox; it does not contact or configure the service.",
        {
          service: z.string().min(2).max(120).describe("The service or MCP server needed, for example GitHub, Google Drive, or a Jira MCP server."),
          reason: z.string().min(8).max(600).describe("Why access is needed to answer the current request."),
          scope: z.string().min(2).max(300).optional().describe("Optional least-privilege access requested, for example read access to GitHub issues."),
        },
        async ({ service, reason, scope }) => {
          const lifecycle = await loadLifecycle(employee.id);
          const result = requestConnection({
            twinId: employee.id,
            twinName: employee.name,
            lifecycle: lifecycle.lifecycle,
            service,
            reason,
            scope,
          });
          const text = !result.ok
            ? result.reason === "retired"
              ? "This twin is retired and cannot request new connections."
              : "You already have five open connection requests. Tell the CEO which existing request should be resolved first."
            : result.deduped
              ? `Updated your open request for ${service}; the admin has been notified again.`
              : `Requested ${service} from the admin through the Inbox.`;
          return { content: [{ type: "text" as const, text }] };
        }
      ),
    ],
  });
}
