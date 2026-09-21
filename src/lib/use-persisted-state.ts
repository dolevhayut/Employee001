"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

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
 * SSR-safe: renders `initial` on the server and during hydration, then reads the
 * persisted value on the client via `useSyncExternalStore` — no hydration
 * mismatch and no synchronous setState inside an effect.
 */
export function usePersistedState<T>(
  key: string | null,
  initial: T | (() => T),
  codec?: Codec<T>,
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const c = codec ?? (identityCodec as Codec<T>);

  // Resolve `initial` exactly once (supports the lazy `() => T` form). Serves as
  // the server snapshot and as the fallback when nothing is persisted yet.
  const [initialValue] = useState<T>(initial);

  // Latest codec, read only inside callbacks. A codec's behavior is fixed for a
  // given key (callers often pass a fresh-but-equivalent object each render), so a
  // one-render-stale read is semantically identical and avoids resubscribes.
  const codecRef = useRef(c);
  useEffect(() => {
    codecRef.current = c;
  });

  // Per-instance subscribers. setValue notifies only this hook instance — we do
  // not sync across instances or tabs (the previous implementation didn't either).
  const listenersRef = useRef<Set<() => void>>(new Set());
  const emit = useCallback(() => {
    for (const l of listenersRef.current) l();
  }, []);

  // In-memory authoritative value: the source of truth when `key === null`, and
  // the retained fallback when a localStorage write fails (quota/serialization),
  // matching the original hook where React state — not storage — was canonical.
  const memoryRef = useRef<T>(initialValue);
  const memoryOnlyRef = useRef(false);

  // Keeps getSnapshot referentially stable: only re-deserialize when the raw
  // stored string actually changes (deserialize can mint a new object each call).
  const cacheRef = useRef<{ raw: string | null | undefined; value: T }>({
    raw: undefined,
    value: initialValue,
  });

  // A fresh key re-hydrates from its own storage; drop any prior memory-only flag.
  useEffect(() => {
    memoryOnlyRef.current = false;
  }, [key]);

  const getSnapshot = useCallback((): T => {
    if (key === null || typeof window === "undefined") return memoryRef.current;
    if (memoryOnlyRef.current) return memoryRef.current;
    let raw: string | null;
    try {
      raw = window.localStorage.getItem(key);
    } catch {
      return memoryRef.current;
    }
    const cache = cacheRef.current;
    if (raw === cache.raw) return cache.value;
    let value: T;
    if (raw === null) {
      value = initialValue;
    } else {
      try {
        value = codecRef.current.deserialize(JSON.parse(raw));
      } catch {
        value = initialValue; // corrupt entry — behave as if unset
      }
    }
    cacheRef.current = { raw, value };
    return value;
  }, [key, initialValue]);

  const getServerSnapshot = useCallback(() => initialValue, [initialValue]);

  const subscribe = useCallback((onStoreChange: () => void) => {
    const listeners = listenersRef.current;
    listeners.add(onStoreChange);
    return () => {
      listeners.delete(onStoreChange);
    };
  }, []);

  const value = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setValue = useCallback<React.Dispatch<React.SetStateAction<T>>>(
    (update) => {
      const prev = getSnapshot();
      const next =
        typeof update === "function" ? (update as (p: T) => T)(prev) : update;
      memoryRef.current = next;
      if (key !== null && typeof window !== "undefined") {
        try {
          const serialized = JSON.stringify(codecRef.current.serialize(next));
          window.localStorage.setItem(key, serialized);
          memoryOnlyRef.current = false;
          // Prime the cache so the next getSnapshot returns `next` (stable ref)
          // without re-parsing what we just wrote.
          cacheRef.current = { raw: serialized, value: next };
        } catch {
          // quota or serialization failure — fall back to in-memory only
          memoryOnlyRef.current = true;
        }
      }
      emit();
    },
    [key, getSnapshot, emit],
  );

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
