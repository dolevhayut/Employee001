import { describe, expect, it } from "vitest";
import { sdkChildEnv } from "./sdk-env";

describe("SDK child env", () => {
  const source = {
    PATH: "/usr/bin",
    HOME: "/home/a",
    LC_ALL: "en_US.UTF-8",
    ANTHROPIC_API_KEY: "sk-ant-x",
    AWS_REGION: "eu-central-1",
    COMPOSIO_API_KEY: "ak_secret",
    OPENAI_API_KEY: "sk-openai",
    ELEVENLABS_API_KEY: "el",
    TELEGRAM_BOT_TOKEN: "tg",
    SLACK_BOT_TOKEN: "xoxb",
    EMPLOYEE001_TOKEN: "workspace",
    DATABASE_URL: "postgres://",
  };

  it("passes only what the child needs", () => {
    const env = sdkChildEnv(source, { CLAUDE_AGENT_SDK_CLIENT_APP: "Employee001" });
    expect(Object.keys(env).sort()).toEqual(["ANTHROPIC_API_KEY", "AWS_REGION", "CLAUDE_AGENT_SDK_CLIENT_APP", "HOME", "LC_ALL", "PATH"]);
  });

  it("passes Claude Code settings by name, never the session a Claude Code terminal exports", () => {
    const env = sdkChildEnv({
      ...source,
      CLAUDE_CONFIG_DIR: "/cfg",
      CLAUDE_CODE_USE_BEDROCK: "1",
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
      CLAUDE_CODE_SDK_HAS_HOST_AUTH_REFRESH: "1",
      CLAUDE_CODE_OAUTH_SCOPES: "user:inference",
      CLAUDE_CODE_OAUTH_TOKEN: "oat",
      CLAUDE_CODE_MESSAGING_TOKEN: "m",
      CLAUDE_CODE_SESSION_ID: "s",
      CLAUDECODE: "1",
    }, {});
    expect(Object.keys(env).filter((k) => k.startsWith("CLAUDE")).sort()).toEqual(["CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC", "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CONFIG_DIR"]);
  });

  it("never leaks app secrets", () => {
    const env = sdkChildEnv(source, {});
    for (const key of ["COMPOSIO_API_KEY", "OPENAI_API_KEY", "ELEVENLABS_API_KEY", "TELEGRAM_BOT_TOKEN", "SLACK_BOT_TOKEN", "EMPLOYEE001_TOKEN", "DATABASE_URL"]) {
      expect(env, key).not.toHaveProperty(key);
    }
  });

  it("lets overrides unset a variable", () => {
    expect(sdkChildEnv(source, { ANTHROPIC_API_KEY: undefined })).not.toHaveProperty("ANTHROPIC_API_KEY");
  });
});
