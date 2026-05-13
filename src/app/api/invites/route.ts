import { NextRequest, NextResponse } from "next/server";
import { createInvite, listInvites } from "@/lib/invites";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ invites: listInvites() });
}

export async function POST(request: NextRequest) {
  // Guard: refuse to create invites when the system can't actually serve a
  // twin. Sending an invite without keys means the employee fills out their
  // profile, then nothing works — bad first impression, broken promise.
  const missing: string[] = [];
  if (!process.env.ANTHROPIC_API_KEY) missing.push("ANTHROPIC_API_KEY");
  if (!process.env.COMPOSIO_API_KEY) missing.push("COMPOSIO_API_KEY");
  if (missing.length > 0) {
    return NextResponse.json(
      {
        error: "not_configured",
        message:
          "Set the missing API keys in .env (or re-run `npx employee001 setup`), then restart the server.",
        missing,
      },
      { status: 409 },
    );
  }

  let body: { name?: unknown; role?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    // empty body is fine — invite still works without name/role hints
  }
  const name = typeof body.name === "string" ? body.name : undefined;
  const role = typeof body.role === "string" ? body.role : undefined;
  const invite = createInvite({ name, role });
  return NextResponse.json({ invite }, { status: 201 });
}
