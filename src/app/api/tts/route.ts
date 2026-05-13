import { NextRequest } from "next/server";

const MAX_CHARS = 5000;

// Default voice: Sarah — soft, conversational
const DEFAULT_VOICE_ID = "EXAVITQu4vr4xnSDxMaL";

// eleven_flash_v2_5: ~75ms latency, 32 languages — best for real-time chat
const MODEL_ID = "eleven_flash_v2_5";

function stripMarkdown(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`]*`/g, "")
    .replace(/#{1,6}\s/g, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^[-*+]\s/gm, "")
    .replace(/^\d+\.\s/gm, "")
    .replace(/^>\s/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function POST(request: NextRequest) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "ELEVENLABS_API_KEY is not configured" }, { status: 500 });
  }

  const body = (await request.json()) as { text?: string; voiceId?: string };
  const rawText = body.text?.trim() ?? "";
  if (!rawText) {
    return Response.json({ error: "text is required" }, { status: 400 });
  }

  const text = stripMarkdown(rawText).slice(0, MAX_CHARS);
  const voiceId = body.voiceId ?? process.env.ELEVENLABS_VOICE_ID ?? DEFAULT_VOICE_ID;

  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: MODEL_ID,
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    }
  );

  if (!res.ok) {
    const errBody = await res.text();
    console.error("[tts] ElevenLabs error", res.status, errBody);
    return Response.json({ error: `TTS request failed: ${res.status}` }, { status: 502 });
  }

  const audioBuffer = await res.arrayBuffer();
  const audioBase64 = Buffer.from(audioBuffer).toString("base64");

  return Response.json({ audioContent: audioBase64, mimeType: "audio/mpeg" });
}
