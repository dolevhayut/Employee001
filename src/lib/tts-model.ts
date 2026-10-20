// Which ElevenLabs model speaks for the twins.
//
// Eleven v4 (Sep 2026) is the most expressive model and clones voices most
// faithfully, in 90+ languages; it works on the regular Create/Stream speech
// endpoints and takes only stability and similarity settings. Set
// ELEVENLABS_TTS_MODEL to override (e.g. eleven_flash_v2_5 for the lowest
// latency). If the chosen model is refused, callers retry once with the
// fallback so a twin never goes silent.

export const TTS_FALLBACK_MODEL = "eleven_flash_v2_5";

export function ttsModel(): string {
  return process.env.ELEVENLABS_TTS_MODEL?.trim() || "eleven_v4";
}

/** POST to an ElevenLabs TTS endpoint, retrying once with the fallback model. */
export async function fetchSpeech(url: string, apiKey: string, text: string): Promise<Response> {
  const call = (model: string) =>
    fetch(url, {
      method: "POST",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        model_id: model,
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    });
  const model = ttsModel();
  const first = await call(model);
  if (first.ok || model === TTS_FALLBACK_MODEL || first.status === 401) return first;
  console.warn(`[tts] ${model} returned ${first.status}; retrying with ${TTS_FALLBACK_MODEL}`);
  return call(TTS_FALLBACK_MODEL);
}
