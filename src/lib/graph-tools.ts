// Microsoft Graph tool implementations used by the in-process MCP server.
// Each tool is a real Graph call against the connected employee's delegated
// token — no mocks.
//
// Tools are gated by which "toolkits" the user has marked ACTIVE in the
// /connections UI: even though one Microsoft token unlocks them all, the CEO
// can curate which surface the twin can act on.

import { Client, AuthenticationProvider } from "@microsoft/microsoft-graph-client";
import { z } from "zod";
import { tool } from "@/lib/agent-sdk/mcp-server";
import type { McpToolDefinition } from "@/lib/agent-sdk/types";
import type { GraphToolkit } from "@/lib/graph-client";

export type GraphAuthProvider = {
  getToken: (scopes?: string[]) => Promise<string>;
};

function makeGraphClient(auth: GraphAuthProvider): Client {
  const provider: AuthenticationProvider = {
    getAccessToken: async () => auth.getToken(),
  };
  return Client.initWithMiddleware({ authProvider: provider });
}

export function buildGraphTools(
  auth: GraphAuthProvider,
  activeToolkits: Set<GraphToolkit>
): McpToolDefinition[] {
  const tools: McpToolDefinition[] = [];

  // ─── Outlook ──────────────────────────────────────────────────────────────
  if (activeToolkits.has("outlook")) {
    tools.push(
      tool(
        "outlook_send_mail",
        "Send an email from the connected user's Outlook mailbox. Body is HTML.",
        {
          to: z.array(z.string()).min(1).describe("Recipient email addresses."),
          subject: z.string().min(1),
          body: z.string().min(1),
          cc: z.array(z.string()).optional(),
          bcc: z.array(z.string()).optional(),
        },
        async (input) => {
          const client = makeGraphClient(auth);
          const message = {
            subject: input.subject,
            body: { contentType: "HTML", content: input.body },
            toRecipients: input.to.map((address) => ({
              emailAddress: { address },
            })),
            ...(input.cc
              ? {
                  ccRecipients: input.cc.map((address) => ({
                    emailAddress: { address },
                  })),
                }
              : {}),
            ...(input.bcc
              ? {
                  bccRecipients: input.bcc.map((address) => ({
                    emailAddress: { address },
                  })),
                }
              : {}),
          };
          await client.api("/me/sendMail").post({ message, saveToSentItems: true });
          return {
            content: [{ type: "text", text: `Email sent to ${input.to.join(", ")}.` }],
          };
        }
      ),
      tool(
        "outlook_search_mail",
        "Search the connected user's Outlook mailbox with a free-text query.",
        {
          query: z.string().min(1).max(200),
          top: z.number().min(1).max(25).optional(),
        },
        async (input) => {
          const client = makeGraphClient(auth);
          const messages = await client
            .api("/me/messages")
            .search(`"${input.query.replace(/"/g, "\\\"")}"`)
            .top(input.top ?? 10)
            .select("subject,from,receivedDateTime,bodyPreview,webLink")
            .get();
          const list = (messages.value ?? []) as Array<{
            subject?: string;
            from?: { emailAddress?: { address?: string; name?: string } };
            receivedDateTime?: string;
            bodyPreview?: string;
            webLink?: string;
          }>;
          const text =
            list.length === 0
              ? "No matching emails."
              : list
                  .map((m) => {
                    const from = m.from?.emailAddress?.address ?? "?";
                    const subject = m.subject ?? "(no subject)";
                    const date = m.receivedDateTime ?? "?";
                    const preview = (m.bodyPreview ?? "").slice(0, 200);
                    return `- [${date}] **${subject}** — from ${from}\n  ${preview}\n  ${m.webLink ?? ""}`;
                  })
                  .join("\n\n");
          return { content: [{ type: "text", text }] };
        }
      ),
      tool(
        "outlook_create_event",
        "Create a calendar event on the connected user's primary calendar.",
        {
          subject: z.string().min(1),
          start: z.string().describe("ISO 8601 start time."),
          end: z.string().describe("ISO 8601 end time."),
          attendees: z.array(z.string()).optional(),
          body: z.string().optional(),
          location: z.string().optional(),
        },
        async (input) => {
          const client = makeGraphClient(auth);
          const event = {
            subject: input.subject,
            start: { dateTime: input.start, timeZone: "UTC" },
            end: { dateTime: input.end, timeZone: "UTC" },
            ...(input.body
              ? { body: { contentType: "HTML", content: input.body } }
              : {}),
            ...(input.attendees
              ? {
                  attendees: input.attendees.map((address) => ({
                    emailAddress: { address },
                    type: "required",
                  })),
                }
              : {}),
            ...(input.location ? { location: { displayName: input.location } } : {}),
          };
          const created = await client.api("/me/events").post(event);
          return {
            content: [
              {
                type: "text",
                text: `Event created: ${created.subject} (${created.id}).`,
              },
            ],
          };
        }
      )
    );
  }

  // ─── Teams ────────────────────────────────────────────────────────────────
  if (activeToolkits.has("teams")) {
    tools.push(
      tool(
        "teams_post_channel_message",
        "Post a message into a Teams channel.",
        {
          teamId: z.string().min(1),
          channelId: z.string().min(1),
          message: z.string().min(1),
        },
        async (input) => {
          const client = makeGraphClient(auth);
          const posted = await client
            .api(`/teams/${input.teamId}/channels/${input.channelId}/messages`)
            .post({
              body: { contentType: "html", content: input.message },
            });
          return {
            content: [
              {
                type: "text",
                text: `Message posted (${posted.id}) into channel ${input.channelId}.`,
              },
            ],
          };
        }
      ),
      tool(
        "teams_send_chat",
        "Send a message into an existing 1:1 or group Teams chat.",
        {
          chatId: z.string().min(1),
          message: z.string().min(1),
        },
        async (input) => {
          const client = makeGraphClient(auth);
          const posted = await client.api(`/chats/${input.chatId}/messages`).post({
            body: { contentType: "html", content: input.message },
          });
          return {
            content: [{ type: "text", text: `Chat message posted (${posted.id}).` }],
          };
        }
      )
    );
  }

  // ─── OneDrive ─────────────────────────────────────────────────────────────
  if (activeToolkits.has("onedrive")) {
    tools.push(
      tool(
        "onedrive_upload",
        "Upload (or overwrite) a small text file to OneDrive at /me/drive/root:/<path>.",
        {
          path: z
            .string()
            .min(1)
            .describe("Drive-relative path, e.g. 'employee001/notes/memo.md'."),
          content: z.string().describe("UTF-8 text content."),
        },
        async (input) => {
          const client = makeGraphClient(auth);
          const item = await client
            .api(`/me/drive/root:/${encodeURI(input.path)}:/content`)
            .put(input.content);
          return {
            content: [
              {
                type: "text",
                text: `Uploaded to OneDrive: ${input.path} (${item.id}, ${item.size ?? "?"} bytes).`,
              },
            ],
          };
        }
      ),
      tool(
        "onedrive_search",
        "Search the connected user's OneDrive for files matching a query.",
        {
          query: z.string().min(1),
          top: z.number().min(1).max(25).optional(),
        },
        async (input) => {
          const client = makeGraphClient(auth);
          const res = await client
            .api(`/me/drive/root/search(q='${input.query.replace(/'/g, "''")}')`)
            .top(input.top ?? 10)
            .get();
          const items = (res.value ?? []) as Array<{
            name?: string;
            webUrl?: string;
            size?: number;
            lastModifiedDateTime?: string;
          }>;
          const text =
            items.length === 0
              ? "No matching files."
              : items
                  .map(
                    (f) =>
                      `- ${f.name} (${f.size ?? "?"} bytes, ${f.lastModifiedDateTime ?? "?"}) — ${f.webUrl ?? ""}`
                  )
                  .join("\n");
          return { content: [{ type: "text", text }] };
        }
      )
    );
  }

  // ─── SharePoint ───────────────────────────────────────────────────────────
  if (activeToolkits.has("sharepoint")) {
    tools.push(
      tool(
        "sharepoint_list_files",
        "List files in a SharePoint document library the connected user can access.",
        {
          siteId: z.string().describe("Graph site id (hostname,siteCollectionId,siteId)."),
          driveId: z.string().describe("Drive id within that site."),
          top: z.number().min(1).max(50).optional(),
        },
        async (input) => {
          const client = makeGraphClient(auth);
          const res = await client
            .api(`/sites/${input.siteId}/drives/${input.driveId}/root/children`)
            .top(input.top ?? 25)
            .get();
          const items = (res.value ?? []) as Array<{
            name?: string;
            webUrl?: string;
            size?: number;
          }>;
          const text =
            items.length === 0
              ? "Drive is empty."
              : items.map((f) => `- ${f.name} (${f.size ?? "?"} bytes) — ${f.webUrl ?? ""}`).join("\n");
          return { content: [{ type: "text", text }] };
        }
      )
    );
  }

  // ─── Planner ─────────────────────────────────────────────────────────────
  if (activeToolkits.has("planner")) {
    tools.push(
      tool(
        "planner_create_task",
        "Create a Planner task in a given plan + bucket.",
        {
          planId: z.string().min(1),
          bucketId: z.string().min(1).optional(),
          title: z.string().min(1),
          dueDateTime: z.string().optional(),
          assigneeUserIds: z.array(z.string()).optional(),
        },
        async (input) => {
          const client = makeGraphClient(auth);
          const body: Record<string, unknown> = {
            planId: input.planId,
            title: input.title,
          };
          if (input.bucketId) body.bucketId = input.bucketId;
          if (input.dueDateTime) body.dueDateTime = input.dueDateTime;
          if (input.assigneeUserIds && input.assigneeUserIds.length > 0) {
            const assignments: Record<string, unknown> = {};
            for (const uid of input.assigneeUserIds) {
              assignments[uid] = { "@odata.type": "#microsoft.graph.plannerAssignment", orderHint: " !" };
            }
            body.assignments = assignments;
          }
          const created = await client.api("/planner/tasks").post(body);
          return {
            content: [{ type: "text", text: `Planner task created (${created.id}).` }],
          };
        }
      ),
      tool(
        "planner_list_tasks",
        "List Planner tasks assigned to the connected user.",
        {
          top: z.number().min(1).max(50).optional(),
        },
        async (input) => {
          const client = makeGraphClient(auth);
          const res = await client.api("/me/planner/tasks").top(input.top ?? 20).get();
          const items = (res.value ?? []) as Array<{
            title?: string;
            id?: string;
            dueDateTime?: string;
            percentComplete?: number;
          }>;
          const text =
            items.length === 0
              ? "No Planner tasks assigned."
              : items
                  .map(
                    (t) =>
                      `- ${t.title ?? "(untitled)"} [${t.percentComplete ?? 0}%]${
                        t.dueDateTime ? ` — due ${t.dueDateTime}` : ""
                      } (${t.id})`
                  )
                  .join("\n");
          return { content: [{ type: "text", text }] };
        }
      )
    );
  }

  // ─── To Do (personal) ────────────────────────────────────────────────────
  if (activeToolkits.has("todo")) {
    tools.push(
      tool(
        "todo_create_task",
        "Create a task in the connected user's default To Do list.",
        {
          title: z.string().min(1),
          dueDateTime: z.string().optional(),
          body: z.string().optional(),
        },
        async (input) => {
          const client = makeGraphClient(auth);
          // Find (or rely on) the default list.
          const listsRes = await client.api("/me/todo/lists").top(1).get();
          const list = (listsRes.value ?? [])[0] as { id?: string } | undefined;
          if (!list?.id) {
            return {
              content: [{ type: "text", text: "No To Do list found for this account." }],
              isError: true,
            };
          }
          const body: Record<string, unknown> = { title: input.title };
          if (input.dueDateTime) {
            body.dueDateTime = { dateTime: input.dueDateTime, timeZone: "UTC" };
          }
          if (input.body) body.body = { content: input.body, contentType: "text" };
          const created = await client.api(`/me/todo/lists/${list.id}/tasks`).post(body);
          return {
            content: [
              { type: "text", text: `To Do task created (${created.id}).` },
            ],
          };
        }
      )
    );
  }

  // ─── Org search (always available if any toolkit is active) ─────────────
  tools.push(
    tool(
      "graph_search_org",
      "Search people across the connected tenant by name or email.",
      {
        query: z.string().min(1).max(120),
        top: z.number().min(1).max(20).optional(),
      },
      async (input) => {
        const client = makeGraphClient(auth);
        const res = await client
          .api(`/users?$search="displayName:${input.query}" OR "mail:${input.query}"`)
          .top(input.top ?? 10)
          .header("ConsistencyLevel", "eventual")
          .select("displayName,mail,jobTitle,userPrincipalName,id")
          .get();
        const items = (res.value ?? []) as Array<{
          displayName?: string;
          mail?: string;
          jobTitle?: string;
          userPrincipalName?: string;
          id?: string;
        }>;
        const text =
          items.length === 0
            ? "No matches."
            : items
                .map(
                  (u) =>
                    `- ${u.displayName ?? "?"} (${u.mail ?? u.userPrincipalName ?? "?"}) — ${u.jobTitle ?? "?"} [${u.id}]`
                )
                .join("\n");
        return { content: [{ type: "text", text }] };
      }
    )
  );

  return tools;
}
