import { NextRequest, NextResponse } from "next/server";
import { createInvite, listInvites } from "@/lib/invites";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ invites: listInvites() });
}

export async function POST(request: NextRequest) {
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
