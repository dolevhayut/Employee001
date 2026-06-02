import { NextRequest } from "next/server";
import { isVoiceConfigured, synthesizeStream } from "@/lib/voice";

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
  if (!isVoiceConfigured()) {
    return Response.json(
      {
        error:
          "Azure Speech is not configured. Set AZURE_SPEECH_KEY and AZURE_SPEECH_REGION.",
      },
      { status: 500 }
    );
  }

  const body = (await request.json()) as { text?: string; voiceId?: string };
  const rawText = body.text?.trim() ?? "";
  if (!rawText) {
    return Response.json({ error: "text is required" }, { status: 400 });
  }

  const text = stripMarkdown(rawText).slice(0, MAX_CHARS);
  const voice = body.voiceId ?? process.env.AZURE_SPEECH_VOICE ?? undefined;

  try {
    const upstream = await synthesizeStream(text, voice);
    if (!upstream.ok) {
      const errText = await upstream.text();
      console.error("[tts/stream] Azure Speech error", upstream.status, errText);
      return Response.json(
        { error: `TTS stream failed: ${upstream.status}` },
        { status: 502 }
      );
    }
    return new Response(upstream.body, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-cache",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[tts/stream] Azure Speech error", message);
    return Response.json({ error: message }, { status: 502 });
  }
}
