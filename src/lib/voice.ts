// Voice synthesis. Replaces ElevenLabs with Azure Speech (Cognitive Services).
// The Azure Speech SDK requires a region + API key (no AAD path for the
// streaming TTS endpoint at the time of the port). Both come from env:
//
//   AZURE_SPEECH_KEY     — speech resource key
//   AZURE_SPEECH_REGION  — e.g. westus3
//   AZURE_SPEECH_VOICE   — optional default neural voice (en-US-AvaMultilingualNeural)
//
// `synthesize(text, voice?)` returns MP3 bytes the API routes wrap as base64.

const DEFAULT_VOICE = "en-US-AvaMultilingualNeural";
const SSML_FORMAT = "audio-24khz-48kbitrate-mono-mp3";

export function isVoiceConfigured(): boolean {
  return Boolean(process.env.AZURE_SPEECH_KEY && process.env.AZURE_SPEECH_REGION);
}

export type SynthesizeResult = {
  /** Raw audio bytes. */
  audio: Buffer;
  /** MIME type of the returned audio. */
  mimeType: "audio/mpeg";
};

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildSsml(text: string, voice: string): string {
  return `<speak version="1.0" xml:lang="en-US"><voice name="${voice}">${escapeXml(
    text
  )}</voice></speak>`;
}

export async function synthesize(
  text: string,
  voice: string = process.env.AZURE_SPEECH_VOICE ?? DEFAULT_VOICE
): Promise<SynthesizeResult> {
  const key = process.env.AZURE_SPEECH_KEY;
  const region = process.env.AZURE_SPEECH_REGION;
  if (!key || !region) {
    throw new Error(
      "Azure Speech is not configured. Set AZURE_SPEECH_KEY and AZURE_SPEECH_REGION."
    );
  }
  const ssml = buildSsml(text, voice);
  const url = `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": key,
      "Content-Type": "application/ssml+xml",
      "X-Microsoft-OutputFormat": SSML_FORMAT,
      "User-Agent": "Employee001",
    },
    body: ssml,
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Azure Speech TTS failed (${res.status}): ${errText}`);
  }
  const audio = Buffer.from(await res.arrayBuffer());
  return { audio, mimeType: "audio/mpeg" };
}

/**
 * Streaming variant: yields chunks as Azure delivers them so the browser can
 * start playback before the full body lands. Returns a fetch Response so the
 * route can `return new Response(res.body, …)` directly.
 */
export async function synthesizeStream(
  text: string,
  voice: string = process.env.AZURE_SPEECH_VOICE ?? DEFAULT_VOICE
): Promise<Response> {
  const key = process.env.AZURE_SPEECH_KEY;
  const region = process.env.AZURE_SPEECH_REGION;
  if (!key || !region) {
    throw new Error(
      "Azure Speech is not configured. Set AZURE_SPEECH_KEY and AZURE_SPEECH_REGION."
    );
  }
  const ssml = buildSsml(text, voice);
  const url = `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`;
  return fetch(url, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": key,
      "Content-Type": "application/ssml+xml",
      "X-Microsoft-OutputFormat": SSML_FORMAT,
      "User-Agent": "Employee001",
    },
    body: ssml,
  });
}
