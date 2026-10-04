import { describe, expect, it } from "vitest";

import {
  ceoOf,
  normalizeOrgIdentity,
  orgClause,
  ORG_DESCRIPTION_MAX,
  ORG_NAME_MAX,
} from "./org-identity";

describe("normalizeOrgIdentity", () => {
  it("collapses control characters and whitespace to single spaces", () => {
    expect(normalizeOrgIdentity({ name: "  Acme\u0000\n\t Labs  ", description: "One\r\n team" })).toEqual({
      name: "Acme Labs",
      description: "One team",
    });
  });

  it("caps name and description lengths", () => {
    expect(normalizeOrgIdentity({ name: "n".repeat(100), description: "d".repeat(250) })).toEqual({
      name: "n".repeat(ORG_NAME_MAX),
      description: "d".repeat(ORG_DESCRIPTION_MAX),
    });
  });
});

describe("organization prompt helpers", () => {
  it("uses neutral fallbacks when no organization is set", () => {
    expect(orgClause({ name: "", description: "" })).toBe("at your company");
    expect(ceoOf({ name: "", description: "" })).toBe("the CEO");
  });

  it("formats an organization with and without a description", () => {
    expect(orgClause({ name: "Acme", description: "A marketplace" })).toBe(
      "at Acme — A marketplace"
    );
    expect(orgClause({ name: "Acme", description: "" })).toBe("at Acme");
    expect(ceoOf({ name: "Acme", description: "ignored" })).toBe("the CEO of Acme");
  });
});
