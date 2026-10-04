"use client";

import { useEffect, useState } from "react";

// One request for every caller. Later mounts read the cached name.
let cached: string | undefined;
let inflight: Promise<string> | null = null;

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

/** Company name from GET /api/org/identity. "" while loading or when unset. */
export function useOrgName(): string {
  const [name, setName] = useState(cached ?? "");

  useEffect(() => {
    let cancelled = false;
    void loadOrgName().then((value) => {
      if (!cancelled) setName(value);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return name;
}
