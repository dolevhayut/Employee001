import { describe, expect, it } from "vitest";
import { publicBaseUrl } from "./public-url";

describe("publicBaseUrl", () => {
  const req = "http://evil.example:9/api/mcp/device/start";

  it("prefers EMPLOYEE001_PUBLIC_URL, then APP_URL, ignoring the request Host", () => {
    expect(publicBaseUrl(req, { EMPLOYEE001_PUBLIC_URL: "https://brain.acme.io/", APP_URL: "https://other.io" })).toBe("https://brain.acme.io");
    expect(publicBaseUrl(req, { APP_URL: "https://brain.acme.io/" })).toBe("https://brain.acme.io");
  });

  it("keeps a sub-path prefix and drops trailing slashes", () => {
    expect(publicBaseUrl(req, { APP_URL: "https://acme.io/brain//" })).toBe("https://acme.io/brain");
  });

  it("falls back to the request origin when nothing usable is configured", () => {
    expect(publicBaseUrl(req, {})).toBe("http://evil.example:9");
    expect(publicBaseUrl(req, { APP_URL: "not a url", EMPLOYEE001_PUBLIC_URL: "javascript:alert(1)" })).toBe("http://evil.example:9");
  });
});
