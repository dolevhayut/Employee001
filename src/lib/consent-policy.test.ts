import { describe, expect, it } from "vitest";

import { actionsAllowed, applyConsent, buildBlockReason, consentStatusFor, toolkitAllowed } from "./consent-policy";
import type { ConsentScope } from "./employees";
import { classifyTool } from "./tool-policy";

const recorded = (...scopes: ConsentScope[]) =>
  consentStatusFor({ consent: { grantedAt: "2026-10-20T00:00:00Z", version: "1.0", scopes } }, false);
const BASE: ConsentScope[] = ["data-collection", "integrations"];
const SEND = "mcp__composio__GMAIL_SEND_EMAIL";

describe("consentStatusFor", () => {
  it("requires consent from a twin with no record; hires and synthetic demo twins are exempt", () => {
    expect(consentStatusFor({}, false)).toEqual({ kind: "consent_required" });
    expect(consentStatusFor({ consent: null }, false)).toEqual({ kind: "consent_required" });
    expect(consentStatusFor({}, true)).toEqual({ kind: "exempt", reason: "marketplace" });
    expect(consentStatusFor({ synthetic: true }, false)).toEqual({ kind: "exempt", reason: "synthetic" });
  });
});

describe("training", () => {
  it("needs recorded consent to data collection; connected tools need integrations too", () => {
    expect(buildBlockReason(recorded(...BASE), "Noa")).toBeNull();
    expect(buildBlockReason(consentStatusFor({}, true), "Alex")).toBeNull();
    expect(buildBlockReason(consentStatusFor({}, false), "Noa")).toContain("hasn't recorded consent");
    // A twin built only from what the person wrote and uploaded: training is
    // allowed, reading their tools isn't (toolkitAllowed below).
    expect(buildBlockReason(recorded("data-collection"), "Noa")).toBeNull();
    expect(toolkitAllowed(recorded("data-collection"), "gmail")).toBe(false);
    expect(buildBlockReason(recorded("integrations"), "Noa")).toContain("doesn't cover training");
  });
});

describe("toolkits", () => {
  it("loads personal toolkits only with integrations, meeting ones only with transcripts", () => {
    expect(toolkitAllowed(recorded(...BASE), "gmail")).toBe(true);
    expect(toolkitAllowed(recorded(...BASE), "zoom")).toBe(false);
    expect(toolkitAllowed(recorded(...BASE, "transcripts"), "zoom")).toBe(true);
    expect(toolkitAllowed(recorded("data-collection"), "gmail")).toBe(false);
  });

  it("denies every personal toolkit, transcripts included, until consent is recorded", () => {
    for (const tk of ["gmail", "slack", "zoom", "fireflies"]) {
      expect(toolkitAllowed(consentStatusFor({}, false), tk), tk).toBe(false);
    }
    expect(toolkitAllowed(consentStatusFor({}, true), "fireflies")).toBe(true);
    expect(toolkitAllowed(consentStatusFor({ synthetic: true }, false), "gmail")).toBe(true);
  });
});

describe("acting on the employee's behalf", () => {
  const allowlist = { servers: [], composioToolkits: ["gmail"], webSearch: false, webOverrides: false };
  const decide = (tool: string, scopes: ConsentScope[]) =>
    applyConsent(classifyTool(tool, { to: "a@b.c" }, undefined, { readAllowlist: allowlist }), tool, recorded(...scopes));

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

  it("blocks every call through the employee's accounts, reads included, without consent", () => {
    const none = consentStatusFor({}, false);
    expect(applyConsent(classifyTool(SEND, {}), SEND, none)).toMatchObject({ kind: "block" });
    const read = "mcp__composio__GMAIL_FETCH_EMAILS";
    expect(applyConsent(classifyTool(read, {}), read, none)).toMatchObject({ kind: "block" });
    expect(actionsAllowed(none)).toBe(false);
  });
});
