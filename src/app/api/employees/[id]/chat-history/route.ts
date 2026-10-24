import { NextRequest, NextResponse } from "next/server";
import { sessionUserFromHeaders } from "@/lib/auth/request-user";
import { canSee, latestAskConversation, loadChatHistory, appendChatMessage, rewriteChatHistory, visibleTo, type StoredMessage } from "@/lib/chat-history";

/** Twin ids are folder names under data/employees; nothing else reaches the disk. */
const validId = (id: string) => /^[a-z0-9_][a-z0-9_-]{1,63}$/.test(id);
const badId = () => NextResponse.json({ error: "invalid twin id" }, { status: 400 });

/**
 * GET: the caller's own history with this twin. `?surface=ask` returns their
 * latest Ask conversation; without it, the chat page's messages.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!validId(id)) return badId();
  const me = sessionUserFromHeaders(req.headers);
  const all = loadChatHistory(id);
  if (new URL(req.url).searchParams.get("surface") === "ask") {
    return NextResponse.json(latestAskConversation(me, all));
  }
  return NextResponse.json(visibleTo(me, all).filter((m) => m.surface !== "ask"));
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : undefined);

function toStored(body: Partial<StoredMessage> | null, askedBy: string | undefined): StoredMessage | null {
  if (!body || (body.role !== "user" && body.role !== "twin") || typeof body.text !== "string") return null;
  const steps = Array.isArray(body.steps)
    ? body.steps.slice(0, 60).flatMap((s) =>
        s && typeof s.label === "string" ? [{ kind: str(s.kind, 20) ?? "read", label: s.label.slice(0, 200), detail: str(s.detail, 300), logo: str(s.logo, 60) }] : [],
      )
    : undefined;
  return {
    ...body,
    role: body.role,
    id: str(body.id, 120) ?? `${Date.now()}`,
    text: body.text.slice(0, 50_000),
    ts: typeof body.ts === "number" ? body.ts : Date.now(),
    // Who asked comes from the session, never from the client.
    askedBy,
    surface: body.surface === "ask" ? "ask" : undefined,
    conversationId: str(body.conversationId, 80),
    steps,
    viaVoice: body.viaVoice === true ? true : undefined,
  };
}

/** One message, or `{ messages: [...] }` (a question and its answer), appended in order. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!validId(id)) return badId();
  const me = sessionUserFromHeaders(req.headers);
  const body = (await req.json().catch(() => null)) as (Partial<StoredMessage> & { messages?: unknown }) | null;
  const raw = Array.isArray(body?.messages) ? (body.messages as Partial<StoredMessage>[]).slice(0, 10) : [body];
  const rows = raw.map((m) => toStored(m, me?.id));
  if (!rows.length || rows.some((r) => !r)) return NextResponse.json({ error: "role and text are required" }, { status: 400 });
  for (const row of rows) appendChatMessage(id, row!);
  return NextResponse.json({ ok: true });
}

/** Clears the caller's own chat-page history with this twin (not the Ask
 *  page's, and not what colleagues asked). */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!validId(id)) return badId();
  const me = sessionUserFromHeaders(req.headers);
  rewriteChatHistory(id, (m) => m.surface === "ask" || !canSee(me, m));
  return NextResponse.json({ ok: true });
}
