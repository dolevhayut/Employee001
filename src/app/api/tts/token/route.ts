import { NextRequest } from "next/server";
import { sessionUserFromHeaders } from "@/lib/auth/request-user";
import { liveTokenRefusal, mintSingleUseToken, resolveTtsVoice, ttsLiveUrl } from "@/lib/voice-live";

// POST /api/tts/token — opens live spoken answers on Ask. Returns the Text to
// Dialogue WebSocket URL (Eleven v4 Turbo, 24 kHz PCM) with a single-use token
// in it, and the voice to register on it: the twin's own when given, else the
// install's default. The browser sends the answer there sentence by sentence
// as the twin writes it. The API key stays here.
// Body: { voiceId?: string, employeeId?: string }

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const refusal = liveTokenRefusal();
  if (refusal) return Response.json({ error: refusal.error }, { status: refusal.status });

  const body = (await request.json().catch(() => ({}))) as { voiceId?: unknown; employeeId?: unknown };
  // A cloned or custom voice needs the person's recorded consent; otherwise the default.
  const { voiceId, fallback, cloned } = await resolveTtsVoice(body?.voiceId, body?.employeeId, process.env, sessionUserFromHeaders(request.headers));
  // The ElevenLabs live token is not bound to a voice: whoever holds it names
  // any voice on the account in the first socket message, so consent could not
  // be enforced. A cloned voice is never given a live token; the client speaks
  // it through /api/tts/stream, which checks consent on the server.
  if (cloned) {
    return Response.json(
      { error: "voice_server_only", message: "This voice is spoken through the server, not a live connection." },
      { status: 409, headers: { "Cache-Control": "no-store" } },
    );
  }
  let token: string | null;
  try {
    token = await mintSingleUseToken("ttd_websocket", request.signal);
  } catch (err) {
    console.error("[tts/token] ElevenLabs unreachable", err instanceof Error ? err.message : err);
    return Response.json({ error: "Text to speech is unreachable" }, { status: 502 });
  }
  if (!token) return Response.json({ error: "Text to speech refused the token request" }, { status: 502 });
  return Response.json({ url: ttsLiveUrl(token), voiceId, ...(fallback ? { voiceFallback: fallback } : {}) }, { headers: { "Cache-Control": "no-store" } });
}
