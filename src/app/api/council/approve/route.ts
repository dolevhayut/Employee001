import { NextRequest } from "next/server";
import { resolveApproval } from "@/lib/approval-bus";

/**
 * POST /api/council/approve
 *
 * Body: {
 *   approvalId: string,
 *   action: "allow" | "deny",
 *   updatedInput?: Record<string, unknown>,  // present when CEO edited args
 *   message?: string,                         // optional feedback for the agent
 * }
 *
 * Resolves a pending tool-approval promise inside the agent runner so the
 * paused agent can either run the (possibly edited) tool call or get a
 * polite denial message it can respond to in chat.
 */
export async function POST(req: NextRequest) {
  let body: {
    approvalId?: string;
    action?: "allow" | "deny";
    updatedInput?: Record<string, unknown>;
    message?: string;
  };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { approvalId, action, updatedInput, message } = body;
  if (!approvalId) {
    return new Response(JSON.stringify({ error: "approvalId is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (action !== "allow" && action !== "deny") {
    return new Response(
      JSON.stringify({ error: "action must be 'allow' or 'deny'" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const decision =
    action === "allow"
      ? { action: "allow" as const, updatedInput }
      : { action: "deny" as const, message };

  const ok = resolveApproval(approvalId, decision);
  if (!ok) {
    return new Response(
      JSON.stringify({ error: "approval not found or already resolved" }),
      { status: 404, headers: { "Content-Type": "application/json" } }
    );
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json" },
  });
}
