import { describe, expect, it } from "vitest";

import { classifyTool, describeTool } from "./tool-policy";

describe("classifyTool", () => {
  it("guarantees every destructive Composio pattern is blocked before any other rule", () => {
    for (const name of [
      "GITHUB_DELETE_REPOSITORY",
      "CRM_DESTROY_CONTACT",
      "STRIPE_REFUND_PAYMENT",
      "STRIPE_CHARGE_CARD",
    ]) {
      expect(classifyTool(name, {})).toMatchObject({ kind: "block" });
    }
  });

  it("guarantees fund transfers are hard-blocked without a trailing tool-name segment", () => {
    expect(classifyTool("BANK_TRANSFER_FUNDS", {})).toMatchObject({ kind: "block" });
  });

  it("guarantees user removals are hard-blocked without a trailing tool-name segment", () => {
    expect(classifyTool("IDENTITY_REMOVE_USER", {})).toMatchObject({ kind: "block" });
  });

  it("guarantees Bash is always hard-blocked", () => {
    expect(classifyTool("Bash", {})).toMatchObject({ kind: "block" });
  });

  it("guarantees NotebookEdit is always hard-blocked", () => {
    expect(classifyTool("NotebookEdit", {})).toMatchObject({ kind: "block" });
  });

  it("guarantees EnterWorktree is always hard-blocked", () => {
    expect(classifyTool("EnterWorktree", {})).toMatchObject({ kind: "block" });
  });

  it("guarantees ExitWorktree is always hard-blocked", () => {
    expect(classifyTool("ExitWorktree", {})).toMatchObject({ kind: "block" });
  });

  it("guarantees read-only action verbs are allowed regardless of casing", () => {
    for (const name of [
      "GITHUB_GET_ISSUE",
      "github_list_repositories",
      "Drive_Search_Files",
      "NOTION_FETCH_PAGE",
      "CRM_RETRIEVE_CONTACT",
      "SLACK_READ_THREAD",
      "LINEAR_FIND_ISSUE",
    ]) {
      expect(classifyTool(name, {})).toEqual({ kind: "allow" });
    }
  });

  it("asks (never auto-allows, never refuses) when a read verb precedes a destructive term", () => {
    expect(classifyTool("BANK_GET_TRANSFER_FUNDS", {}).kind).toBe("ask");
    expect(classifyTool("STRIPE_LIST_PAYMENT_METHODS", {}).kind).toBe("ask");
  });

  it("never auto-allows a combined read-and-destroy action", () => {
    expect(classifyTool("STRIPE_LIST_AND_DELETE_CHARGES", {}).kind).not.toBe("allow");
    expect(classifyTool("GMAIL_FIND_AND_DELETE_EMAIL", {}).kind).not.toBe("allow");
  });

  it("still allows plain reads that carry no destructive term", () => {
    expect(classifyTool("IDENTITY_LIST_USERS", {})).toEqual({ kind: "allow" });
  });

  it("guarantees MCP-prefixed read-only actions are allowed", () => {
    expect(classifyTool("mcp__composio__GITHUB_GET_ISSUE", {})).toEqual({ kind: "allow" });
    expect(classifyTool("mcp__COMPOSIO__github_list_repositories", {})).toEqual({
      kind: "allow",
    });
  });

  it("guarantees all explicitly local safe tools are allowed", () => {
    for (const name of [
      "Read",
      "Glob",
      "Grep",
      "Write",
      "WebSearch",
      "WebFetch",
      "ToolSearch",
      "Task",
      "create_artifact",
      "share_with_meeting",
      "read_meeting_file",
      "view_meeting_image",
      "analyze_csv",
      "query_csv",
      "consult_twin",
      "request_approval",
    ]) {
      expect(classifyTool(name, {})).toEqual({ kind: "allow" });
    }
  });

  it("guarantees an MCP prefix does not prevent a local safe bare name from being allowed", () => {
    expect(classifyTool("mcp__internal__Read", {})).toEqual({ kind: "allow" });
  });

  it("guarantees Slack writes request approval with the chosen channel", () => {
    expect(classifyTool("mcp__composio__SLACK_SEND_MESSAGE", { channel: "#security" })).toEqual({
      kind: "ask",
      reason: "About to send a Slack message to #security. Public message — review before sending.",
    });
    expect(classifyTool("SLACK_REPLY", { channel_name: "ops" })).toMatchObject({
      kind: "ask",
      reason: expect.stringContaining("ops"),
    });
  });

  it("guarantees email writes request approval with string and array recipients", () => {
    expect(classifyTool("GMAIL_SEND_EMAIL", { to: "ada@example.test" })).toMatchObject({
      kind: "ask",
      reason: expect.stringContaining("ada@example.test"),
    });
    expect(classifyTool("OUTLOOK_REPLY", { to: ["ada@example.test", "lin@example.test"] })).toMatchObject({
      kind: "ask",
      reason: expect.stringContaining("ada@example.test, lin@example.test"),
    });
  });

  it("guarantees create and mutation actions request approval", () => {
    expect(classifyTool("GITHUB_CREATE_AN_ISSUE", {})).toMatchObject({ kind: "ask" });
    for (const name of ["GITHUB_UPDATE_ISSUE", "CRM_PATCH_CONTACT", "GIT_MERGE_PR"]) {
      expect(classifyTool(name, {})).toMatchObject({ kind: "ask" });
    }
  });

  it("guarantees otherwise unknown Composio-shaped and empty names default to approval", () => {
    expect(classifyTool("VENDOR_DO_THING", {})).toEqual({
      kind: "ask",
      reason: "VENDOR_DO_THING is an external action. Confirm before running.",
    });
    expect(classifyTool("", undefined)).toEqual({
      kind: "ask",
      reason: " is an unrecognized tool. Confirm before running.",
    });
    expect(classifyTool("customTool", {})).toMatchObject({ kind: "ask" });
  });
});

describe("describeTool", () => {
  it("guarantees Composio action names become approval-card headings", () => {
    expect(describeTool("GITHUB_CREATE_AN_ISSUE")).toBe("Github: create an issue");
    expect(describeTool("mcp__composio__SLACK_SEND_MESSAGE")).toBe("Slack: send message");
  });

  it("guarantees a one-word name is preserved", () => {
    expect(describeTool("Read")).toBe("Read");
  });

  it("guarantees MCP prefix stripping is case-insensitive", () => {
    expect(describeTool("mcp__COMPOSIO__GITHUB_CREATE_ISSUE")).toBe("Github: create issue");
  });
});
