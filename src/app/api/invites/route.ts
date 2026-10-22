import { NextRequest, NextResponse } from "next/server";
import { canRunModel, currentProvider, providerLabel } from "@/lib/model-provider";
import { createInvite, listInvites } from "@/lib/invites";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ invites: listInvites() });
}

export async function POST(request: NextRequest) {
  // Guard: refuse to create invites when the system can't actually serve a
  // twin. Sending an invite without keys means the employee fills out their
  // profile, then nothing works — bad first impression, broken promise.
  // The builder runs on the configured provider (Anthropic, Bedrock, Vertex,
  // Foundry or local), so check that provider, not the Anthropic key.
  const model = canRunModel();
  const missing: string[] = [];
  if (!model.ok) missing.push(currentProvider() === "anthropic" ? "ANTHROPIC_API_KEY" : "EMPLOYEE001_MODEL_PROVIDER");
  if (!process.env.COMPOSIO_API_KEY) missing.push("COMPOSIO_API_KEY");
  if (missing.length > 0) {
    const problems = [
      ...(model.ok ? [] : [`${providerLabel(currentProvider())}: ${model.reason}`]),
      ...(process.env.COMPOSIO_API_KEY ? [] : ["COMPOSIO_API_KEY is not configured"]),
    ];
    return NextResponse.json(
      {
        error: "not_configured",
        message: `${problems.join("; ")}. Fix it in .env (or re-run \`npx employee001 setup\`), then restart the server.`,
        missing,
      },
      { status: 409 },
    );
  }

  let body: { name?: unknown; role?: unknown; lookbackDays?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    // empty body is fine — invite still works without name/role hints
  }
  const name = typeof body.name === "string" ? body.name : undefined;
  const role = typeof body.role === "string" ? body.role : undefined;

  // lookbackDays: required integer in [30, 360]. Absent => default 90.
  // Reject explicit out-of-range values rather than silently clamping —
  // a slider that asks for 720 days is a bug somewhere, not a UX rounding.
  let lookbackDays: number | undefined;
  if (body.lookbackDays !== undefined && body.lookbackDays !== null) {
    const n =
      typeof body.lookbackDays === "number"
        ? body.lookbackDays
        : Number(body.lookbackDays);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 30 || n > 360) {
      return NextResponse.json(
        {
          error: "lookback_out_of_range",
          message: "lookbackDays must be between 30 and 360",
        },
        { status: 400 },
      );
    }
    lookbackDays = n;
  }

  const invite = createInvite({ name, role, lookbackDays });
  return NextResponse.json({ invite }, { status: 201 });
}
