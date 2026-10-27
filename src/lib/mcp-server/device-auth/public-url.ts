type Env = Record<string, string | undefined>;

/**
 * Base URL a person opens in their browser: EMPLOYEE001_PUBLIC_URL, else APP_URL,
 * else the origin of the request. The request origin comes from the Host header,
 * so behind a proxy or on an exposed bind the configured value is the trusted one.
 */
export function publicBaseUrl(requestUrl: string, env: Env = process.env): string {
  for (const raw of [env.EMPLOYEE001_PUBLIC_URL, env.APP_URL]) {
    const value = raw?.trim().replace(/\/+$/, "");
    if (!value) continue;
    try {
      const url = new URL(value);
      if (url.protocol === "http:" || url.protocol === "https:") return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
    } catch {
      /* not a URL: fall through to the next source */
    }
  }
  return new URL(requestUrl).origin;
}
