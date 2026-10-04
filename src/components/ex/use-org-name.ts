"use client";

import { useEffect, useState } from "react";

// One request for every caller. Later mounts read the cached name, and
// Settings pushes a saved name to every mounted caller via setOrgName().
let cached: string | undefined;
let inflight: Promise<string> | null = null;
const listeners = new Set<(name: string) => void>();

function loadOrgName(): Promise<string> {
  if (cached !== undefined) return Promise.resolve(cached);
  if (!inflight) {
    inflight = fetch("/api/org/identity", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) return "";
        const data = (await res.json()) as { identity?: { name?: unknown } };
        return typeof data.identity?.name === "string" ? data.identity.name : "";
      })
      .catch(() => "")
      .then((name) => {
        cached = name;
        return name;
      });
  }
  return inflight;
}

/** Call after saving the org identity so every mounted useOrgName() updates. */
export function setOrgName(name: string): void {
  cached = name;
  listeners.forEach((listener) => listener(name));
}

/** Company name from GET /api/org/identity. "" while loading or when unset. */
export function useOrgName(): string {
  const [name, setName] = useState(cached ?? "");

  useEffect(() => {
    let cancelled = false;
    const listener = (value: string) => {
      if (!cancelled) setName(value);
    };
    listeners.add(listener);
    void loadOrgName().then(listener);
    return () => {
      cancelled = true;
      listeners.delete(listener);
    };
  }, []);

  return name;
}
