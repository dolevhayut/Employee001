import { NextResponse } from "next/server";
import { sessionUserFromHeaders } from "@/lib/auth/request-user";
import { addKnowledgeFolder, listKnowledgeFolders, removeKnowledgeFolder } from "@/lib/knowledge-folders";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return NextResponse.json({ folders: listKnowledgeFolders(id) });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: { path?: unknown; label?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "The request was not valid JSON. Reload the page and try again." }, { status: 400 }); }
  const me = sessionUserFromHeaders(request.headers);
  const result = await addKnowledgeFolder(id, body, { userId: me?.id });
  if (!result.folder) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ folder: result.folder }, { status: 201 });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: { path?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "The request was not valid JSON. Reload the page and try again." }, { status: 400 }); }
  if (typeof body.path !== "string") return NextResponse.json({ error: "Say which folder to remove: send its path." }, { status: 400 });
  const me = sessionUserFromHeaders(request.headers);
  if (!await removeKnowledgeFolder(id, body.path, { userId: me?.id })) {
    return NextResponse.json({ error: "That folder isn't on this twin's list any more. Reload the page to see the current folders." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
