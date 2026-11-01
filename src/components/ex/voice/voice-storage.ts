import { ELEVENLABS_VOICE_STORAGE_KEY } from "@/lib/employees";

/** Drops one person's locally chosen voice (the `twin.ttsVoices` map entry), e.g. when their voice consent is withdrawn. */
export function clearStoredVoice(employeeId: string, storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> = localStorage): void {
  try {
    const raw = storage.getItem(ELEVENLABS_VOICE_STORAGE_KEY);
    if (!raw) return;
    const all = JSON.parse(raw) as Record<string, string>;
    if (!all || typeof all !== "object" || !(employeeId in all)) return;
    delete all[employeeId];
    if (Object.keys(all).length) storage.setItem(ELEVENLABS_VOICE_STORAGE_KEY, JSON.stringify(all));
    else storage.removeItem(ELEVENLABS_VOICE_STORAGE_KEY);
  } catch { /* unreadable storage: nothing to clear */ }
}

/** The "why the default voice spoke" note from a /api/tts/stream response, if any. */
export function voiceFallbackNote(headers: Pick<Headers, "get">): string | null {
  return headers.get("X-Voice-Fallback-Message") || null;
}
