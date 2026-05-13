import fs from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { loadChatHistory, appendChatMessage, type StoredMessage } from "@/lib/chat-history";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return NextResponse.json(loadChatHistory(id));
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json() as StoredMessage;
  appendChatMessage(id, body);
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const p = path.join(process.cwd(), "data/employees", id, "chat-history.jsonl");
  if (fs.existsSync(p)) fs.unlinkSync(p);
  return NextResponse.json({ ok: true });
}
