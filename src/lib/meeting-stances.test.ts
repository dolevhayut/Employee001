import { describe, expect, it } from "vitest";
import { normalizeStances } from "./meeting-stances";

const transcript = [
  { kind: "ceo" as const },
  { kind: "twin" as const, employeeId: "a" },
  { kind: "twin" as const, employeeId: "b" },
  { kind: "twin" as const, employeeId: "a" },
];

describe("normalizeStances", () => {
  it("keeps stances that point at the speaker's own turn", () => {
    expect(
      normalizeStances(
        [
          { employeeId: "b", stance: "object", turn: 2 },
          { employeeId: "a", stance: "accept", turn: 1 },
        ],
        transcript,
      ),
    ).toEqual([
      { employeeId: "a", stance: "accept", turn: 1 },
      { employeeId: "b", stance: "object", turn: 2 },
    ]);
  });

  it("drops wrong speaker, CEO turns, out-of-range turns and bad values", () => {
    expect(
      normalizeStances(
        [
          { employeeId: "a", stance: "accept", turn: 2 },
          { employeeId: "a", stance: "accept", turn: 0 },
          { employeeId: "a", stance: "accept", turn: 9 },
          { employeeId: "a", stance: "maybe", turn: 1 },
          { employeeId: "a", stance: "accept", turn: "1.5" },
          { employeeId: "a", stance: "accept", turn: 1.5 },
          null,
        ],
        transcript,
      ),
    ).toEqual([]);
  });

  it("keeps the latest stance per twin", () => {
    expect(
      normalizeStances(
        [
          { employeeId: "a", stance: "object", turn: 1 },
          { employeeId: "a", stance: "accept", turn: 3 },
        ],
        transcript,
      ),
    ).toEqual([{ employeeId: "a", stance: "accept", turn: 3 }]);
  });

  it("maps turns of a transcript tail back to full-transcript indices", () => {
    expect(normalizeStances([{ employeeId: "b", stance: "object", turn: 12 }], transcript.slice(1), 11)).toEqual([
      { employeeId: "b", stance: "object", turn: 12 },
    ]);
    expect(normalizeStances([{ employeeId: "a", stance: "accept", turn: 1 }], transcript.slice(1), 11)).toEqual([]);
  });

  it("drops speakers that are not on the roster", () => {
    expect(
      normalizeStances(
        [
          { employeeId: "a", stance: "accept", turn: 1 },
          { employeeId: "b", stance: "object", turn: 2 },
        ],
        transcript,
        0,
        new Set(["a"]),
      ),
    ).toEqual([{ employeeId: "a", stance: "accept", turn: 1 }]);
  });

  it("accepts a whole-number turn quoted as a string", () => {
    expect(normalizeStances([{ employeeId: "a", stance: "accept", turn: "1" }], transcript)).toEqual([
      { employeeId: "a", stance: "accept", turn: 1 },
    ]);
  });

  it("returns [] for missing data (old meetings)", () => {
    expect(normalizeStances(undefined, transcript)).toEqual([]);
  });
});
