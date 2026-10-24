import { NextRequest, NextResponse } from "next/server";
import { Composio } from "@composio/core";

export const runtime = "nodejs";

function configuredAppBaseUrl(): string | null {
  const configured = (process.env.EMPLOYEE001_PUBLIC_URL ?? process.env.APP_URL ?? "")
    .trim()
    .replace(/\/$/, "");
  return configured || null;
}

/** Public base URL for invite links (APP_URL / EMPLOYEE001_PUBLIC_URL), never a secret. */
export async function GET() {
  return NextResponse.json(
    { appUrl: configuredAppBaseUrl() },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * POST /api/system/composio-check
 * Body: { apiKey: string }
 * One cheap authenticated Composio call to verify the key before saving.
 */
export async function POST(req: NextRequest) {
  let body: { apiKey?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, message: "Invalid request body" }, { status: 400 });
  }

  const apiKey = body.apiKey?.trim();
  if (!apiKey) {
    return NextResponse.json({ ok: false, message: "API key is required" }, { status: 400 });
  }

  try {
    const composio = new Composio({ apiKey });
    await composio.toolkits.get({ limit: 1 });
    return NextResponse.json({ ok: true, message: "Composio API key is valid" });
  } catch (err) {
    const message =
      err instanceof Error && err.message
        ? err.message
        : "Composio rejected this API key (check the key at app.composio.dev)";
    const status = /unauthorized|401|invalid.*key/i.test(message) ? 401 : 400;
    return NextResponse.json({ ok: false, message }, { status });
  }
}
