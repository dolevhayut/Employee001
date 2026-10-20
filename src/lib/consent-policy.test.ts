import { describe, expect, it } from "vitest";

import { applyConsent, buildBlockReason, consentStatusFor, toolkitAllowed } from "./consent-policy";
import type { ConsentScope } from "./employees";
import { classifyTool } from "./tool-policy";

const recorded = (...scopes: ConsentScope[]) =>
  consentStatusFor({ consent: { grantedAt: "2026-10-20T00:00:00Z", version: "1.0", scopes } }, false);
const BASE: ConsentScope[] = ["data-collection", "integrations"];
const SEND = "mcp__composio__GMAIL_SEND_EMAIL";

describe("consentStatusFor", () => {
  it("treats a twin with no record as legacy and marketplace hires as exempt", () => {
    expect(consentStatusFor({}, false)).toEqual({ kind: "legacy" });
    expect(consentStatusFor({ consent: null }, false)).toEqual({ kind: "legacy" });
    expect(consentStatusFor({}, true)).toEqual({ kind: "exempt" });
  });
});

describe("training", () => {
  it("needs recorded consent to data collection and integrations", () => {
    expect(buildBlockReason(recorded(...BASE), "Noa")).toBeNull();
    expect(buildBlockReason(consentStatusFor({}, true), "Alex")).toBeNull();
    expect(buildBlockReason(consentStatusFor({}, false), "Noa")).toContain("hasn't recorded consent");
    expect(buildBlockReason(recorded("data-collection"), "Noa")).toContain("doesn't cover training");
  });
});

describe("toolkits", () => {
  it("loads personal toolkits only with integrations, meeting ones only with transcripts", () => {
    expect(toolkitAllowed(recorded(...BASE), "gmail")).toBe(true);
    expect(toolkitAllowed(recorded(...BASE), "zoom")).toBe(false);
    expect(toolkitAllowed(recorded(...BASE, "transcripts"), "zoom")).toBe(true);
    expect(toolkitAllowed(recorded("data-collection"), "gmail")).toBe(false);
  });

  it("leaves legacy and marketplace twins as they were", () => {
    expect(toolkitAllowed(consentStatusFor({}, false), "zoom")).toBe(true);
    expect(toolkitAllowed(consentStatusFor({}, true), "fireflies")).toBe(true);
  });
});

describe("acting on the employee's behalf", () => {
  const decide = (tool: string, scopes: ConsentScope[]) =>
    applyConsent(classifyTool(tool, { to: "a@b.c" }), tool, recorded(...scopes));

  it("refuses actions through the employee's accounts without third-party-actions", () => {
    expect(decide(SEND, BASE)).toMatchObject({ kind: "block" });
    expect(decide("mcp__composio__GITHUB_CREATE_AN_ISSUE", BASE)).toMatchObject({ kind: "block" });
  });

  it("keeps them behind the approval gate when the employee allowed it", () => {
    expect(decide(SEND, [...BASE, "third-party-actions"])).toMatchObject({ kind: "ask" });
  });

  it("never touches reads, web fetches or org-wide tools", () => {
    expect(decide("mcp__composio__GMAIL_FETCH_EMAILS", BASE)).toEqual({ kind: "allow" });
    expect(decide("WebFetch", BASE)).toMatchObject({ kind: "ask" });
    expect(decide("mcp__apify__call-actor", BASE)).toMatchObject({ kind: "ask" });
  });

  it("doesn't restrict legacy twins", () => {
    const decision = applyConsent(classifyTool(SEND, {}), SEND, consentStatusFor({}, false));
    expect(decision).toMatchObject({ kind: "ask" });
  });
});
