"use client";

// The demo's recorded answers, spoken: a pre-rendered clip played on the same
// AudioContext as live speech (unlocked by the click that asked), so it plays
// without a key and without autoplay trouble.

import { playbackContext } from "./live-speaker";

export type DemoClip = { stop: () => void };

export async function playDemoClip(url: string, on: { playing?: () => void; ended?: () => void } = {}): Promise<DemoClip | null> {
  let stopped = false;
  let source: AudioBufferSourceNode | null = null;
  const clip: DemoClip = {
    stop: () => {
      if (stopped) return;
      stopped = true;
      try {
        source?.stop();
      } catch {
        // never started
      }
    },
  };
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.arrayBuffer();
    const ctx = playbackContext();
    if (!ctx || stopped) return null;
    const buffer = await ctx.decodeAudioData(data);
    if (stopped) return null;
    source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.onended = () => {
      stopped = true;
      on.ended?.();
    };
    source.start();
    on.playing?.();
    return clip;
  } catch {
    return null;
  }
}
