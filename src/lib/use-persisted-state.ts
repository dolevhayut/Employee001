"use client";

import { useEffect, useRef, useState } from "react";

type Codec<T> = {
  serialize: (value: T) => unknown;
  deserialize: (raw: unknown) => T;
};

const identityCodec: Codec<unknown> = {
  serialize: (v) => v,
  deserialize: (r) => r,
};

export const setCodec = <V,>(): Codec<Set<V>> => ({
  serialize: (value) => Array.from(value),
  deserialize: (raw) => new Set(Array.isArray(raw) ? (raw as V[]) : []),
});

/**
 * State that survives a page refresh by mirroring to localStorage.
 *
 * Pass `key=null` to opt out of persistence (acts like plain useState).
 * SSR-safe: hydrates from storage in an effect, then writes on every change.
 */
export function usePersistedState<T>(
  key: string | null,
  initial: T | (() => T),
  codec?: Codec<T>,
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const c = (codec ?? (identityCodec as Codec<T>));
  const [value, setValue] = useState<T>(initial);
  const hydratedRef = useRef(false);

  useEffect(() => {
    if (!key || typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(key);
      if (raw != null) {
        const parsed = JSON.parse(raw);
        setValue(c.deserialize(parsed));
      }
    } catch {
      /* ignore corrupt entry */
    } finally {
      hydratedRef.current = true;
    }
    // We intentionally hydrate once per key change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    if (!key || typeof window === "undefined") return;
    if (!hydratedRef.current) return;
    try {
      const payload = c.serialize(value);
      window.localStorage.setItem(key, JSON.stringify(payload));
    } catch {
      /* quota or serialization failure — fall back to in-memory only */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, value]);

  return [value, setValue];
}

export function clearPersistedKeys(prefix: string) {
  if (typeof window === "undefined") return;
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(prefix)) toRemove.push(k);
    }
    toRemove.forEach((k) => window.localStorage.removeItem(k));
  } catch {
    /* ignore */
  }
}
