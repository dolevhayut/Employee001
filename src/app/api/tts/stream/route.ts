import { NextRequest } from "next/server";
import { AI_AUDIO_HEADERS } from "@/lib/ai-disclosure";
import { elevenLabsBase, voiceEnabled } from "@/lib/data-residency";
import { fetchSpeech } from "@/lib/tts-model";
import { liveVoiceId } from "@/lib/voice-live";

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

  const body = (await request.json()) as { text?: string; voiceId?: string };
  const rawText = body.text?.trim() ?? "";
  if (!rawText) {
    return Response.json({ error: "text is required" }, { status: 400 });
  }

  const text = stripMarkdown(rawText).slice(0, MAX_CHARS);
  // Same pick as live speech: the twin's voice, the install default, or Sarah.
  const voiceId = liveVoiceId(body.voiceId);

  const upstream = await fetchSpeech(`${elevenLabsBase()}/v1/text-to-speech/${voiceId}/stream`, apiKey, text);

  if (!upstream.ok) {
    const err = await upstream.text();
    console.error("[tts/stream] ElevenLabs error", upstream.status, err);
    return Response.json({ error: `TTS stream failed: ${upstream.status}` }, { status: 502 });
  }

  return new Response(upstream.body, {
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
      ...AI_AUDIO_HEADERS,
    },
  });
}
