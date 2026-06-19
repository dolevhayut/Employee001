import { NextRequest } from "next/server";
import { isVoiceConfigured, synthesize } from "@/lib/voice";

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
    const { audio, mimeType } = await synthesize(text, voice);
    return Response.json({
      audioContent: audio.toString("base64"),
      mimeType,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[tts] Azure Speech error", message);
    return Response.json({ error: message }, { status: 502 });
  }
}
