import { describe, expect, it } from "vitest";
import {
  acceptedSharedTokens,
  matchesSharedToken,
  personalSignInEnabled,
  sharedTokenAllowed,
} from "./shared-token-policy";

const tokens = { EMPLOYEE001_MCP_TOKEN: "mcp-tok", EMPLOYEE001_TOKEN: "app-tok" };

describe("shared-token policy (AC4)", () => {
  it("is unchanged while personal sign-in is off", () => {
    expect(personalSignInEnabled(tokens)).toBe(false);
    expect(acceptedSharedTokens(tokens)).toEqual(["mcp-tok", "app-tok"]);
    expect(matchesSharedToken("app-tok", tokens)).toBe(true);
  });

  it("is off by default once personal sign-in is enabled", () => {
    const env = { ...tokens, EMPLOYEE001_MCP_PERSONAL_SIGNIN: "1" };
    expect(sharedTokenAllowed(env)).toBe(false);
    expect(acceptedSharedTokens(env)).toEqual([]);
    expect(matchesSharedToken("mcp-tok", env)).toBe(false);
    expect(matchesSharedToken("app-tok", env)).toBe(false);
  });

  it("needs an explicit admin opt-in to come back", () => {
    const env = {
      ...tokens,
      EMPLOYEE001_MCP_PERSONAL_SIGNIN: "true",
      EMPLOYEE001_MCP_ALLOW_SHARED_TOKEN: "1",
    };
    expect(matchesSharedToken("mcp-tok", env)).toBe(true);
    expect(matchesSharedToken("app-tok", env)).toBe(true);
    expect(matchesSharedToken("wrong-tk", env)).toBe(false);
    expect(matchesSharedToken("", env)).toBe(false);
  });

  it("falsy values enable nothing", () => {
    expect(personalSignInEnabled({ EMPLOYEE001_MCP_PERSONAL_SIGNIN: "0" })).toBe(false);
    const env = {
      ...tokens,
      EMPLOYEE001_MCP_PERSONAL_SIGNIN: "1",
      EMPLOYEE001_MCP_ALLOW_SHARED_TOKEN: "no",
    };
    expect(sharedTokenAllowed(env)).toBe(false);
  });

  it("ignores unset tokens", () => {
    expect(acceptedSharedTokens({ EMPLOYEE001_TOKEN: "x" })).toEqual(["x"]);
    expect(matchesSharedToken("", {})).toBe(false);
  });

  it("rejects different-length and prefix bearers without throwing", () => {
    expect(matchesSharedToken("", tokens)).toBe(false);
    expect(matchesSharedToken("mcp", tokens)).toBe(false);
    expect(matchesSharedToken("mcp-tok-and-more", tokens)).toBe(false);
    expect(matchesSharedToken("mcp-tok", tokens)).toBe(true);
  });
});
