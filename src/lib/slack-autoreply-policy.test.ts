import { describe, expect, it } from "vitest";
import { normalizeSlackAutoReplyConfig, slackAutoReplyDecision, type SlackAutoReplyConfig } from "./slack-autoreply-policy";
import { buildToolConfig, PUBLIC_PROFILE_FILE_NAMES } from "./council-runner";

const config: SlackAutoReplyConfig = { members: [{ slackUserId: "U1", label: "Dana" }], channels: ["C1"] };
const msg = { userId: "U1", channel: "C1", isDm: false, text: "What's the Q3 roadmap?" };

describe("Slack auto-reply policy", () => {
  it("requires approval by default", () => {
    expect(slackAutoReplyDecision({ twinAutoReplyEnabled: false, config, message: msg }).mode).toBe("approval");
    expect(slackAutoReplyDecision({ twinAutoReplyEnabled: true, config: { members: [], channels: [] }, message: msg }).mode).toBe("approval");
  });

  it("auto-replies only to an allowlisted sender in an allowlisted channel or DM", () => {
    const auto = slackAutoReplyDecision({ twinAutoReplyEnabled: true, config, message: msg });
    expect(auto).toMatchObject({ mode: "auto", requester: { slackUserId: "U1" } });
    expect(slackAutoReplyDecision({ twinAutoReplyEnabled: true, config, message: { ...msg, channel: "C2", isDm: true } }).mode).toBe("auto");
    expect(slackAutoReplyDecision({ twinAutoReplyEnabled: true, config, message: { ...msg, channel: "C2" } }).mode).toBe("approval");
    expect(slackAutoReplyDecision({ twinAutoReplyEnabled: true, config, message: { ...msg, userId: "U9" } }).mode).toBe("approval");
  });

  it("never auto-replies to external workspaces or requests to act", () => {
    expect(slackAutoReplyDecision({ twinAutoReplyEnabled: true, config, message: { ...msg, externalWorkspace: true } }).mode).toBe("approval");
    expect(slackAutoReplyDecision({ twinAutoReplyEnabled: true, config, message: { ...msg, text: "please send the invoice" } }).mode).toBe("approval");
    expect(slackAutoReplyDecision({ twinAutoReplyEnabled: true, config, message: { ...msg, text: "תשלח לי את הקובץ" } }).mode).toBe("approval");
  });

  it("drops malformed allowlist entries", () => {
    const c = normalizeSlackAutoReplyConfig({ members: [{ slackUserId: "u1" }, { slackUserId: "u1" }, { slackUserId: "<script>" }, {}], channels: ["c1", "#general", 4] });
    expect(c).toEqual({ members: [{ slackUserId: "U1" }], channels: ["C1"] });
  });

  it("drafts auto-replies with no tools and only the public profile files", () => {
    expect(buildToolConfig({ publicReply: true }).allowedTools).toEqual([]);
    expect(buildToolConfig({ publicReply: true }).disallowedTools).toEqual(expect.arrayContaining(["Read", "Grep", "Glob", "WebSearch", "WebFetch"]));
    expect(PUBLIC_PROFILE_FILE_NAMES).not.toContain("PEOPLE.md");
    expect(PUBLIC_PROFILE_FILE_NAMES).not.toContain("DECISIONS.md");
    expect(PUBLIC_PROFILE_FILE_NAMES).not.toContain("EMPLOYMENT.md");
  });
});
