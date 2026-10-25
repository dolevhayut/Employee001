import { NextResponse } from "next/server";
import { addKnowledgeFolder, listKnowledgeFolders, removeKnowledgeFolder } from "@/lib/knowledge-folders";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return NextResponse.json({ folders: listKnowledgeFolders(id) });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: { path?: unknown; label?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON." }, { status: 400 }); }
  const result = await addKnowledgeFolder(id, body);
  if (!result.folder) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ folder: result.folder }, { status: 201 });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: { path?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON." }, { status: 400 }); }
  if (typeof body.path !== "string") return NextResponse.json({ error: "Folder path is required." }, { status: 400 });
  if (!await removeKnowledgeFolder(id, body.path)) return NextResponse.json({ error: "Folder was not found." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
