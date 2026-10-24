import { NextRequest } from "next/server";
import { liveTokenRefusal, mintSingleUseToken, sttRealtimeUrl } from "@/lib/voice-live";

// POST /api/stt/token — opens live speech input on Ask. Returns the Scribe v2
// Realtime WebSocket URL with a single-use token in it (one connection, 15
// minutes); the browser streams the mic there itself. The API key stays here.
// Body (optional JSON): { language?: ISO-639-1/3 }; without it Scribe detects
// the language, so Hebrew and English both work.

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const refusal = liveTokenRefusal();
  if (refusal) return Response.json({ error: refusal.error }, { status: refusal.status });

  const body = (await request.json().catch(() => ({}))) as { language?: unknown };
  let token: string | null;
  try {
    token = await mintSingleUseToken("realtime_scribe", request.signal);
  } catch (err) {
    console.error("[stt/token] ElevenLabs unreachable", err instanceof Error ? err.message : err);
    return Response.json({ error: "Speech to text is unreachable" }, { status: 502 });
  }
  if (!token) return Response.json({ error: "Speech to text refused the token request" }, { status: 502 });
  return Response.json({ url: sttRealtimeUrl(token, { language: body?.language }) }, { headers: { "Cache-Control": "no-store" } });
}
