import { NextRequest, NextResponse } from "next/server";
import { deleteCustomPlaybook, getPlaybook, updateCustomPlaybook } from "@/lib/playbooks/store";
import { PlaybookSchema } from "@/lib/playbooks/types";
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: NextRequest, context: Context) { const { id } = await context.params; const playbook = getPlaybook(id); return playbook ? NextResponse.json({ playbook }) : NextResponse.json({ error: "playbook not found" }, { status: 404 }); }
export async function PATCH(request: NextRequest, context: Context) {
  const { id } = await context.params; if (!id.startsWith("custom-")) return NextResponse.json({ error: "built-in playbooks cannot be edited" }, { status: 403 });
  let body: unknown; try { body = await request.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  const parsed = PlaybookSchema.omit({ id: true }).partial().safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid playbook", details: parsed.error.flatten() }, { status: 400 });
  try { const playbook = updateCustomPlaybook(id, parsed.data); return playbook ? NextResponse.json({ playbook }) : NextResponse.json({ error: "playbook not found" }, { status: 404 }); } catch { return NextResponse.json({ error: "invalid playbook" }, { status: 400 }); }
}
export async function DELETE(_request: NextRequest, context: Context) { const { id } = await context.params; if (!id.startsWith("custom-")) return NextResponse.json({ error: "built-in playbooks cannot be deleted" }, { status: 403 }); return deleteCustomPlaybook(id) ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "playbook not found" }, { status: 404 }); }
