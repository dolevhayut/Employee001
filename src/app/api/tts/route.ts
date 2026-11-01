import { NextRequest } from "next/server";
import { AI_AUDIO_HEADERS } from "@/lib/ai-disclosure";
import { elevenLabsBase, voiceEnabled } from "@/lib/data-residency";
import { sessionUserFromHeaders } from "@/lib/auth/request-user";
import { fetchSpeech } from "@/lib/tts-model";
import { resolveTtsVoice } from "@/lib/voice-live";

const MAX_CHARS = 5000;

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
  if (!voiceEnabled()) {
    return Response.json({ error: "voice_disabled", message: "Voice is off on this install (EMPLOYEE001_VOICE=off, or EU region without an EU ElevenLabs endpoint)." }, { status: 403 });
  }
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "ELEVENLABS_API_KEY is not configured" }, { status: 500 });
  }

  const body = (await request.json()) as { text?: string; voiceId?: string; employeeId?: string };
  const rawText = body.text?.trim() ?? "";
  if (!rawText) {
    return Response.json({ error: "text is required" }, { status: 400 });
  }

  const text = stripMarkdown(rawText).slice(0, MAX_CHARS);
  // A cloned or custom voice needs the person's recorded consent; otherwise the default.
  const { voiceId, fallback } = await resolveTtsVoice(body.voiceId, body.employeeId, process.env, sessionUserFromHeaders(request.headers));

  // Model: eleven_v4 by default (see lib/tts-model.ts), with a fallback.
  const res = await fetchSpeech(`${elevenLabsBase()}/v1/text-to-speech/${voiceId}`, apiKey, text);

  if (!res.ok) {
    const errBody = await res.text();
    console.error("[tts] ElevenLabs error", res.status, errBody);
    return Response.json({ error: `TTS request failed: ${res.status}` }, { status: 502 });
  }

  const audioBuffer = await res.arrayBuffer();
  const audioBase64 = Buffer.from(audioBuffer).toString("base64");

  return Response.json(
    { audioContent: audioBase64, mimeType: "audio/mpeg", ...(fallback ? { voiceFallback: fallback } : {}) },
    { headers: AI_AUDIO_HEADERS },
  );
}
