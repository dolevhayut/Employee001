import { afterEach, describe, expect, it } from "vitest";
import { GET } from "./route";

describe("GET /api/system/composio-check", () => {
  const env = process.env;

  afterEach(() => {
    process.env = env;
  });

  it("returns configured APP_URL as appUrl", async () => {
    process.env = { ...env, APP_URL: "https://team.example.com/", EMPLOYEE001_PUBLIC_URL: undefined };
    const res = await GET();
    const body = (await res.json()) as { appUrl: string | null };
    expect(body.appUrl).toBe("https://team.example.com");
  });

  it("prefers EMPLOYEE001_PUBLIC_URL over APP_URL", async () => {
    process.env = {
      ...env,
      APP_URL: "https://ignored.example.com",
      EMPLOYEE001_PUBLIC_URL: "https://public.example.com",
    };
    const res = await GET();
    const body = (await res.json()) as { appUrl: string | null };
    expect(body.appUrl).toBe("https://public.example.com");
  });

  it("returns null when no public URL is configured", async () => {
    process.env = { ...env, APP_URL: undefined, EMPLOYEE001_PUBLIC_URL: undefined };
    const res = await GET();
    const body = (await res.json()) as { appUrl: string | null };
    expect(body.appUrl).toBeNull();
  });
});
