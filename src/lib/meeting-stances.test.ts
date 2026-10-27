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
          { employeeId: "a", stance: "accept", turn: "1" },
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

  it("returns [] for missing data (old meetings)", () => {
    expect(normalizeStances(undefined, transcript)).toEqual([]);
  });
});
