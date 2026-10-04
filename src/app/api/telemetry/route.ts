import { NextRequest, NextResponse } from "next/server";
import { getTelemetryPreview, getTelemetrySettings, setTelemetryConsent } from "@/lib/telemetry";

export const runtime = "nodejs";

export async function GET() {
  const settings = getTelemetrySettings();
  return NextResponse.json({ consent: settings.consent, preview: await getTelemetryPreview() }, {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(req: NextRequest) {
  // Require a JSON content type: it forces a CORS preflight, so another site
  // open in the browser can't flip consent with a "simple" cross-site POST.
  if (!req.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return NextResponse.json({ error: "json_required" }, { status: 415 });
  }
  let body: { consent?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  if (typeof body.consent !== "boolean") {
    return NextResponse.json({ error: "consent_required" }, { status: 400 });
  }
  const settings = setTelemetryConsent(body.consent);
  return NextResponse.json({ consent: settings.consent });
}
