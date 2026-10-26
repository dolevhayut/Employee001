import { describe, expect, it } from "vitest";
import { isSafeImageSrc, styleLoadsResource } from "./safe-image-src";

describe("isSafeImageSrc", () => {
  it("loads only same-origin paths and inline images", () => {
    for (const ok of ["/avatars/a.png", "data:image/png;base64,AAAA", "blob:http://localhost/x"]) expect(isSafeImageSrc(ok), ok).toBe(true);
  });
  it("refuses remote, protocol-relative and script URLs", () => {
    for (const bad of ["https://attacker.example/?d=secret", "http://127.0.0.1:3001/x", "//attacker.example/x", "/\\attacker.example", "javascript:alert(1)", "data:text/html,<b>", " https://x", undefined, 42]) {
      expect(isSafeImageSrc(bad), String(bad)).toBe(false);
    }
  });
});

describe("styleLoadsResource", () => {
  it("spots CSS that fetches", () => {
    expect(styleLoadsResource("background:url(https://x/?d=1)")).toBe(true);
    expect(styleLoadsResource("background-image: image-set('x' 1x)")).toBe(true);
    expect(styleLoadsResource("color: red; padding: 4px")).toBe(false);
  });
});
