import { NextRequest } from "next/server";
import { sessionUserFromHeaders } from "@/lib/auth/request-user";
import { ROLE_RANK } from "@/lib/auth/rbac";
import { EMPLOYEE_ID, VOICE_CONSENT_TEXT, voiceConsentStatus } from "@/lib/employees";
import { loadVoiceConsent, recordVoiceConsent, voiceConsentDigest } from "@/lib/employees-disk";

export const runtime = "nodejs";

const VOICE_ID = /^[A-Za-z0-9]{1,64}$/;

type Ctx = { params: Promise<{ employeeId: string }> };

/**
 * GET /api/tts/consent/[employeeId]?voiceId=… — the wording to show, its
 * digest, and the recorded consent (if any). `covers` says whether the consent
 * is for the given voice id, so the voice id itself never has to be returned.
 */
export async function GET(req: NextRequest, ctx: Ctx) {
  const { employeeId } = await ctx.params;
  if (!EMPLOYEE_ID.test(employeeId)) return Response.json({ error: "employeeId is required" }, { status: 400 });
  // Status only: the voice id, IP and user agent stay in the record and the audit log.
  const c = await loadVoiceConsent(employeeId);
  const voiceId = req.nextUrl.searchParams.get("voiceId");
  return Response.json({
    text: VOICE_CONSENT_TEXT,
    textSha256: voiceConsentDigest(),
    consent: c ? voiceConsentStatus(c) : null,
    covers: Boolean(c && voiceId && c.voiceId === voiceId),
  });
}

/**
 * POST /api/tts/consent/[employeeId] — record or withdraw consent to use a
 * cloned or custom voice for a person.
 * Body: `{ agree: boolean, voiceId?: string }` (voiceId is needed to agree).
 * Only the person signed in as themself gives it first-hand; anyone else (an
 * admin, or a workspace without accounts) is recorded as "on behalf".
 * Withdrawing deletes the voice id and writes an audit entry.
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  const { employeeId } = await ctx.params;
  if (!EMPLOYEE_ID.test(employeeId)) return Response.json({ error: "employeeId is required" }, { status: 400 });
  const body = (await req.json().catch(() => ({}))) as { agree?: unknown; voiceId?: unknown };
  if (typeof body.agree !== "boolean") return Response.json({ error: "agree must be true or false" }, { status: 400 });
  if (body.agree && (typeof body.voiceId !== "string" || !VOICE_ID.test(body.voiceId))) {
    return Response.json({ error: "voiceId is required to give consent" }, { status: 400 });
  }
  const me = sessionUserFromHeaders(req.headers);
  // With accounts on, only the person themself or an admin may speak for a voice.
  if (me && ROLE_RANK[me.role] < ROLE_RANK.admin && me.employeeId !== employeeId) {
    return Response.json({ error: "Only the person or an admin can record voice consent" }, { status: 403 });
  }
  const result = await recordVoiceConsent(employeeId, {
    agree: body.agree,
    voiceId: typeof body.voiceId === "string" ? body.voiceId : "",
    onBehalf: me?.employeeId !== employeeId,
    actor: { userId: me?.id },
    headers: req.headers,
  });
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  return Response.json({ consent: result.voiceConsent ? voiceConsentStatus(result.voiceConsent) : null });
}
