import { describe, expect, it } from "vitest";
import { hasEmptyShellApiKey } from "../../bin/commands/doctor.mjs";

describe("hasEmptyShellApiKey", () => {
  it("flags an empty ANTHROPIC_API_KEY", () => {
    expect(hasEmptyShellApiKey({ ANTHROPIC_API_KEY: "" })).toBe(true);
    expect(hasEmptyShellApiKey({ ANTHROPIC_API_KEY: "  " })).toBe(true);
  });
  it("ignores an unset ANTHROPIC_API_KEY", () => {
    expect(hasEmptyShellApiKey({})).toBe(false);
  });
  it("ignores a non-empty ANTHROPIC_API_KEY", () => {
    expect(hasEmptyShellApiKey({ ANTHROPIC_API_KEY: "sk-ant-x" })).toBe(false);
  });
});
