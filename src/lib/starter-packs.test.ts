import { describe, expect, it } from "vitest";
import { STARTER_PACKS, isUnchangedExample, livePack, planStarterPack, type AppliedPack } from "./starter-packs";

const [a, b] = STARTER_PACKS;
const appliedA: AppliedPack = { id: a.id, role: a.role, notes: a.notes };

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

describe("planStarterPack", () => {
  it("fills an empty form with the pack and its role", () => {
    const plan = planStarterPack({ written: "", role: "", applied: null }, a);
    expect(plan).toMatchObject({ action: "set", written: a.notes, role: a.role, applied: appliedA });
  });

  it("keeps the person's own text and adds the example below it", () => {
    const plan = planStarterPack({ written: "My own notes.", role: "CTO", applied: null }, a);
    expect(plan).toMatchObject({ action: "set", written: `My own notes.\n\n${a.notes}`, role: "CTO" });
  });

  it("replaces an untouched example with another pack, role included", () => {
    const plan = planStarterPack({ written: a.notes, role: a.role, applied: appliedA }, b);
    expect(plan).toMatchObject({ action: "set", written: b.notes, role: b.role });
  });

  it("keeps a role the person typed themselves", () => {
    const plan = planStarterPack({ written: a.notes, role: "Founder", applied: appliedA }, b);
    expect(plan).toMatchObject({ action: "set", role: "Founder" });
  });

  it("does nothing when the same pack is picked over edited text", () => {
    expect(planStarterPack({ written: `${a.notes} edited`, role: a.role, applied: appliedA }, a)).toEqual({ action: "noop" });
  });

  it("asks before replacing an edited example with a different pack", () => {
    const plan = planStarterPack({ written: `${a.notes} edited`, role: a.role, applied: appliedA }, b);
    expect(plan).toMatchObject({ action: "confirm", written: b.notes, role: b.role });
  });
});

describe("isUnchangedExample", () => {
  it("is true while the example sits in the notes untouched, alone or below their own text", () => {
    expect(isUnchangedExample(a.notes, appliedA)).toBe(true);
    // Adding text around it doesn't make the invented rules theirs.
    expect(isUnchangedExample(`${a.notes}\nMore.`, appliedA)).toBe(true);
    expect(isUnchangedExample(`My own line.\n\n${a.notes}`, appliedA)).toBe(true);
    expect(isUnchangedExample(a.notes.replace(/\.\s*$/, "!"), appliedA)).toBe(false); // edited
    expect(isUnchangedExample(a.notes, null)).toBe(false);
  });
});

describe("livePack", () => {
  it("forgets the pack once its example left the notes", () => {
    expect(livePack(a.notes, appliedA)).toBe(appliedA);
    expect(livePack("All my own words now.", appliedA)).toBeNull();
    // Picking the same pack again then adds it, instead of claiming it is already there.
    const plan = planStarterPack({ written: "All my own words now.", role: a.role, applied: livePack("All my own words now.", appliedA) }, a);
    expect(plan).toMatchObject({ action: "set", written: `All my own words now.\n\n${a.notes}` });
  });
});
