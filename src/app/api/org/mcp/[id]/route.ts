import { NextResponse } from "next/server";
import {
  deleteCustomMcp,
  updateCustomMcp,
  type UpdateCustomMcpInput,
} from "@/lib/custom-mcp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const body = (await request.json()) as UpdateCustomMcpInput;
    const next = await updateCustomMcp(id, body);
    if (!next) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    return NextResponse.json({ server: next });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const ok = await deleteCustomMcp(id);
  if (!ok) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
