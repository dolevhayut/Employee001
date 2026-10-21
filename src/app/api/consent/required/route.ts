import { listConsentRequired } from "@/lib/consent-migration";

export const runtime = "nodejs";

/** Twins waiting for their employee's consent (deny-by-default banner). */
export async function GET() {
  return Response.json({ twins: listConsentRequired() }, { headers: { "Cache-Control": "no-store" } });
}
