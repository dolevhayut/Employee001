import { NextRequest } from "next/server";
import { sessionUserFromHeaders } from "@/lib/auth/request-user";
import { recordRetentionConsent } from "@/lib/twin-lifecycle";
import { loadHandoverState } from "@/lib/relay/handover-state";

export const runtime = "nodejs";

/**
 * The departing employee's answer to "keep my twin after I leave?".
 * Body: `{ agree: boolean, locale?: "en" | "he" }`. Recorded with the
 * consent text digest in the audit log; a "no" withdraws an earlier "yes".
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ employeeId: string }> }) {
  const { employeeId } = await ctx.params;
  if (!(await loadHandoverState(employeeId))) return Response.json({ error: "Twin not found" }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { agree?: unknown; locale?: unknown };
  if (typeof body.agree !== "boolean") return Response.json({ error: "agree must be true or false" }, { status: 400 });
  const me = sessionUserFromHeaders(req.headers);
  const result = await recordRetentionConsent(employeeId, {
    agree: body.agree,
    locale: body.locale === "he" ? "he" : "en",
    actor: { userId: me?.id, role: me?.role },
    headers: req.headers,
  });
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  return Response.json(await loadHandoverState(employeeId));
}
