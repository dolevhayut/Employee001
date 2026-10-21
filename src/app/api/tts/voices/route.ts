import { elevenLabsBase, voiceEnabled } from "@/lib/data-residency";

export async function GET() {
  if (!voiceEnabled()) {
    return Response.json({ error: "voice_disabled", message: "Voice is off on this install (EMPLOYEE001_VOICE=off, or EU region without an EU ElevenLabs endpoint)." }, { status: 403 });
  }
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "ELEVENLABS_API_KEY is not configured" }, { status: 500 });
  }

  const res = await fetch(`${elevenLabsBase()}/v1/voices`, {
    headers: { "xi-api-key": apiKey },
    next: { revalidate: 3600 }, // cache 1h — voices don't change often
  });

  if (!res.ok) {
    return Response.json({ error: `ElevenLabs voices failed: ${res.status}` }, { status: 502 });
  }

  const data = await res.json() as {
    voices: Array<{
      voice_id: string;
      name: string;
      category: string;
      labels?: Record<string, string>;
      preview_url?: string;
    }>;
  };

  return Response.json({ voices: data.voices });
}
