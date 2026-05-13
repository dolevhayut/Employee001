"use client";

import { useEffect, useState } from "react";

// Module-level cache — fetched once per browser session
const iconCache = new Map<string, string>(); // slug → iconUrl (empty string = no icon)
let catalogLoaded = false;
let catalogPromise: Promise<void> | null = null;

function ensureCatalog(): Promise<void> {
  if (catalogLoaded) return Promise.resolve();
  if (!catalogPromise) {
    catalogPromise = fetch("/api/connections/toolkits")
      .then((r) => r.json())
      .then((data: { toolkits: Array<{ slug: string; iconUrl?: string }> }) => {
        for (const t of data.toolkits ?? []) {
          iconCache.set(t.slug.toLowerCase(), t.iconUrl ?? "");
        }
        catalogLoaded = true;
      })
      .catch(() => {
        catalogLoaded = true; // don't retry
      });
  }
  return catalogPromise;
}

export function ToolkitIcon({
  slug,
  iconUrl: preloadedUrl,
  size = 20,
  style,
}: {
  slug: string;
  iconUrl?: string;
  size?: number;
  style?: React.CSSProperties;
}) {
  const normalSlug = slug.toLowerCase();

  const [url, setUrl] = useState<string | undefined>(() => {
    if (preloadedUrl) return preloadedUrl;
    if (catalogLoaded) return iconCache.get(normalSlug) || undefined;
    return undefined;
  });
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    if (url || imgError) return;
    ensureCatalog().then(() => {
      const cached = iconCache.get(normalSlug);
      if (cached) setUrl(cached);
    });
  }, [normalSlug, url, imgError]);

  const base: React.CSSProperties = { width: size, height: size, flexShrink: 0, ...style };

  if (!url || imgError) {
    return (
      <span
        style={{
          ...base,
          borderRadius: 4,
          background: "var(--hairline)",
          display: "grid",
          placeItems: "center",
          fontSize: Math.max(8, Math.round(size * 0.38)),
          fontWeight: 700,
          color: "var(--text-muted)",
          textTransform: "uppercase",
          letterSpacing: "-0.02em",
        }}
      >
        {slug.slice(0, 2)}
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt=""
      width={size}
      height={size}
      style={{ ...base, borderRadius: 4, objectFit: "contain" }}
      onError={() => setImgError(true)}
    />
  );
}
