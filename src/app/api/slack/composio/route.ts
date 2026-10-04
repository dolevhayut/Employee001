import { verifyComposioWebhook } from "@/lib/email-intake-trigger";
import { ingestSlackMessage, mappedTwinForMessage, shouldIgnoreSlackMessage, slackFromTriggerPayload } from "@/lib/slack-intake";
import { loadEmployeesFromDisk } from "@/lib/employees-disk";
import { readState } from "@/lib/composio-client";

export const runtime = "nodejs";

/** Composio signs raw delivery bytes; normalize only after verification. */
export async function POST(request: Request) {
  const raw = await request.text();
  const verified = await verifyComposioWebhook({ payload: raw, signature: request.headers.get("webhook-signature"), id: request.headers.get("webhook-id"), timestamp: request.headers.get("webhook-timestamp"), secret: process.env.COMPOSIO_WEBHOOK_SECRET });
  if (!verified) return Response.json({ error: "unauthorized" }, { status: 401 });
  const envelope = verified as { payload?: unknown; rawPayload?: unknown };
  const message = slackFromTriggerPayload(envelope.payload ?? envelope.rawPayload);
  if (!message) return Response.json({ error: "invalid_event" }, { status: 400 });
  const employees = await loadEmployeesFromDisk();
  const mappings = await Promise.all(employees.map(async (employee) => {
    const slack = (await readState(employee.id)).connections.slack;
    return { employeeId: employee.id, slackUserId: slack?.slackUserId, workspaceId: slack?.slackWorkspaceId };
  }));
  const employeeId = mappedTwinForMessage(message, mappings);
  if (!employeeId) return Response.json({ ignored: "unmapped" });
  const own = mappings.find((m) => m.employeeId === employeeId)?.slackUserId;
  if (shouldIgnoreSlackMessage(message, own)) return Response.json({ ignored: "bot_or_self" });
  const result = ingestSlackMessage(employeeId, message);
  return Response.json(result, { status: result.deduped ? 200 : 202 });
}
