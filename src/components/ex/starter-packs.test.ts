import { describe, expect, it } from "vitest";
import { STARTER_PACKS } from "@/lib/marketplace";

describe("STARTER_PACKS", () => {
  it("has unique ids and enough material to build from", () => {
    expect(new Set(STARTER_PACKS.map((p) => p.id)).size).toBe(STARTER_PACKS.length);
    for (const p of STARTER_PACKS) expect(p.notes.length).toBeGreaterThanOrEqual(200);
  });

  it("holds no secrets, emails, urls, phone numbers or personal names", () => {
    for (const p of STARTER_PACKS) {
      const text = `${p.title} ${p.role} ${p.summary} ${p.notes}`;
      expect(text).not.toMatch(/@|https?:\/\/|sk-[A-Za-z0-9]|api[_ -]?key|password|token|\+?\d[\d\s-]{8,}/i);
      expect(text).not.toMatch(/\b(Alex|Morgan|Noa|Amit|Dana|Lior|Shira|Yoav)\b/);
    }
  });
});
