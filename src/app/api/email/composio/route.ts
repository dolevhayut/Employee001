import { emailFromTriggerPayload, ingestEmailMessage } from "@/lib/email-intake";
import { verifyComposioWebhook } from "@/lib/email-intake-trigger";

export const runtime = "nodejs";

/** Raw text is intentional: Composio signs the unparsed body. */
export async function POST(request: Request) {
  const raw = await request.text();
  const verified = await verifyComposioWebhook({ payload: raw, signature: request.headers.get("webhook-signature"), id: request.headers.get("webhook-id"), timestamp: request.headers.get("webhook-timestamp"), secret: process.env.COMPOSIO_WEBHOOK_SECRET, scope: "composio-email" });
  if (!verified) return Response.json({ error: "unauthorized" }, { status: 401 });
  const envelope = verified as { payload?: unknown; rawPayload?: unknown };
  const event = envelope.payload as { userId?: unknown; user_id?: unknown; data?: Record<string, unknown>; metadata?: Record<string, unknown> } | undefined;
  // SDK-normalized V1 puts this at the root, V2 in data, and V3 in metadata.
  const candidates = [event?.userId, event?.user_id, event?.data?.userId, event?.data?.user_id, event?.metadata?.userId, event?.metadata?.user_id];
  const userId = candidates.find((value): value is string => typeof value === "string");
  const email = emailFromTriggerPayload(envelope.payload ?? envelope.rawPayload);
  if (!userId?.startsWith("employee:") || !email) return Response.json({ error: "invalid_event" }, { status: 400 });
  const result = ingestEmailMessage(userId.slice("employee:".length), email);
  return Response.json(result, { status: result.deduped ? 200 : 202 });
}
