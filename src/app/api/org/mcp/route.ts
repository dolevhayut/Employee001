import { NextResponse } from "next/server";
import {
  createCustomMcp,
  listCustomMcp,
  type CreateCustomMcpInput,
} from "@/lib/custom-mcp";
import { CLIENT_METADATA_URL_ENV, isClientMetadataUrlConfigured } from "@/lib/mcp-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const servers = await listCustomMcp();
  // Lets Settings hide quick-add presets that can't connect on this install.
  const presetCapabilities = {
    oauthClientMetadataConfigured: isClientMetadataUrlConfigured(process.env[CLIENT_METADATA_URL_ENV]),
  };
  return NextResponse.json(
    { servers, presetCapabilities },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<CreateCustomMcpInput>;
    const created = await createCustomMcp({
      name: String(body.name ?? ""),
      description: body.description ? String(body.description) : undefined,
      transport: (body.transport === "sse" ? "sse" : "http"),
      url: String(body.url ?? ""),
      headers: Array.isArray(body.headers) ? body.headers : [],
      enabled: body.enabled ?? true,
    });
    return NextResponse.json({ server: created }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
