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
