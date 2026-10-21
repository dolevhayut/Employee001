"use client";

import { useEffect, useState } from "react";

// Whether voice may be used on this install (data-residency.ts): `voice` is
// server STT/TTS, `voiceAllowed` also covers the browser's own speech
// recognition, which sends audio to the browser vendor. Off until known.

export type VoicePolicy = { voice: boolean; voiceAllowed: boolean };

let cached: Promise<VoicePolicy> | null = null;

function loadPolicy(): Promise<VoicePolicy> {
  cached ??= fetch("/api/system/config", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : {}))
    .then((c: Partial<VoicePolicy>) => ({ voice: Boolean(c.voice), voiceAllowed: Boolean(c.voiceAllowed) }))
    .catch(() => ({ voice: false, voiceAllowed: false }));
  return cached;
}

export function useVoicePolicy(): VoicePolicy {
  const [policy, setPolicy] = useState<VoicePolicy>({ voice: false, voiceAllowed: false });
  useEffect(() => {
    let alive = true;
    loadPolicy().then((p) => {
      if (alive) setPolicy(p);
    });
    return () => {
      alive = false;
    };
  }, []);
  return policy;
}
