import { NextRequest, NextResponse } from "next/server";
import { createCustomPlaybook, listPlaybooks } from "@/lib/playbooks/store";
import { PlaybookSchema } from "@/lib/playbooks/types";
export async function GET() {
  return NextResponse.json({ playbooks: listPlaybooks() });
}
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  if (!body || typeof body !== "object")
    return NextResponse.json({ error: "invalid playbook" }, { status: 400 });
  const input = { ...(body as Record<string, unknown>) };
  delete input.id;
  const parsed = PlaybookSchema.omit({ id: true }).safeParse(input);
  if (!parsed.success)
    return NextResponse.json(
      { error: "invalid playbook", details: parsed.error.flatten() },
      { status: 400 },
    );
  try {
    return NextResponse.json(
      { playbook: createCustomPlaybook(parsed.data) },
      { status: 201 },
    );
  } catch {
    return NextResponse.json(
      { error: "failed to save playbook" },
      { status: 500 },
    );
  }
}
