// Option shapes that keep a twin run isolated from Claude Code's own session
// tools, its built-in subagents and the app's secrets. The real-CLI proof is
// a probe (docs/local/strategy/2026-10-27-probes/); these pin the shapes.

import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CLAUDE_BUILTIN_SUBAGENTS_DENY,
  TWIN_CHAT_TOOLS,
  TWIN_HARD_DISALLOWED,
  TWIN_SHIFT_TOOLS,
  buildBaseOptions,
  twinDisallowedTools,
  twinPermissionDenyRules,
} from "./sdk-defaults";
import { PEER_PROFILE_FILES, TWIN_DENIED_DATA_PATHS, checkTwinRead, isDeniedDataPath } from "./twin-read-scope";
import { buildToolConfig } from "./council-runner";

const HOME = "/home/u";
const APP = "/srv/e001 app";
const DATA = path.join(APP, "data");
const ME = "noa-friedman";

// Claude Code session tools a twin must never see.
const SESSION_TOOLS = [
  "Bash", "CronCreate", "CronDelete", "CronList", "DesignSync", "EnterWorktree", "ExitWorktree",
  "ListAgents", "Monitor", "NotebookEdit", "PushNotification", "RemoteTrigger", "ReportFindings",
  "ScheduleWakeup", "SendMessage", "TaskGet", "TaskList", "TaskStop", "Workflow", "Skill",
];

/** Gitignore-style match of a "Tool(//abs/glob)" rule target against an
 *  absolute path: "**" crosses "/", "*" doesn't. */
function ruleMatches(rule: string, abs: string): boolean {
  const target = /^\w+\((.*)\)$/.exec(rule)?.[1] ?? "";
  const pattern = target.startsWith("~/") ? `${HOME}/${target.slice(2)}` : target.replace(/^\/\//, "/");
  const re = pattern
    .split("**")
    .map((part) => part.split("*").map((s) => s.replace(/[.+^${}()|[\]\\?]/g, "\\$&")).join("[^/]*"))
    .join(".*");
  return new RegExp(`^${re}$`).test(abs);
}

let savedHome: string | undefined;
beforeEach(() => {
  savedHome = process.env.EMPLOYEE001_HOME;
  process.env.EMPLOYEE001_HOME = APP;
});
afterEach(() => {
  if (savedHome === undefined) delete process.env.EMPLOYEE001_HOME;
  else process.env.EMPLOYEE001_HOME = savedHome;
});

describe("twin built-in tool allowlists", () => {
  it("gives a chat twin exactly the tools it uses", () => {
    expect([...TWIN_CHAT_TOOLS].sort()).toEqual([
      "AskUserQuestion", "Edit", "Glob", "Grep", "Read", "Task", "TaskCreate", "TaskUpdate",
      "ToolSearch", "WebFetch", "WebSearch", "Write",
    ]);
    // A shift is unattended and has no agents of its own.
    expect(TWIN_SHIFT_TOOLS).not.toContain("Task");
    expect(TWIN_SHIFT_TOOLS).not.toContain("AskUserQuestion");
    for (const t of SESSION_TOOLS) {
      expect(TWIN_CHAT_TOOLS).not.toContain(t);
      expect(TWIN_SHIFT_TOOLS).not.toContain(t);
    }
  });

  it("always denies the hard list and Claude Code's own subagents", () => {
    const list = twinDisallowedTools(["Read", "Bash"]);
    for (const t of [...TWIN_HARD_DISALLOWED, ...CLAUDE_BUILTIN_SUBAGENTS_DENY, "Read"]) expect(list).toContain(t);
    expect(list.filter((t) => t === "Bash")).toHaveLength(1);
    expect([...CLAUDE_BUILTIN_SUBAGENTS_DENY].sort()).toEqual([
      "Agent(Explore)", "Agent(Plan)", "Agent(claude)", "Agent(general-purpose)", "Agent(statusline-setup)",
    ]);
  });
});

describe("council buildToolConfig", () => {
  const variants = {
    full: {},
    readOnly: { readOnly: true },
    answerOnly: { answerOnly: true },
    publicReply: { publicReply: true },
    retired: { retired: true },
  } as const;

  for (const [name, opts] of Object.entries(variants)) {
    it(`${name}: keeps Bash and Claude Code's subagents denied, and no session tools`, () => {
      const cfg = buildToolConfig(opts);
      for (const t of [...TWIN_HARD_DISALLOWED, ...CLAUDE_BUILTIN_SUBAGENTS_DENY]) expect(cfg.disallowedTools).toContain(t);
      for (const t of SESSION_TOOLS) expect(cfg.tools).not.toContain(t);
      // Nothing explicitly disallowed is in the allowlist.
      for (const t of cfg.tools) expect(cfg.disallowedTools).not.toContain(t);
    });
  }

  it("sets the per-variant built-in allowlist", () => {
    expect(buildToolConfig({}).tools).toEqual([...TWIN_CHAT_TOOLS]);
    expect(buildToolConfig({}).agents).toBeDefined();
    expect(buildToolConfig({ readOnly: true }).tools).toEqual(["Read", "Glob", "Grep", "WebSearch", "ToolSearch"]);
    expect(buildToolConfig({ answerOnly: true }).tools).toEqual(["Read", "Glob", "Grep", "ToolSearch"]);
    expect(buildToolConfig({ publicReply: true }).tools).toEqual([]);
    expect(buildToolConfig({ retired: true }).tools).toEqual([]);
    expect(buildToolConfig({ retired: true }).agents).toBeUndefined();
  });

  it("runs Employee001's subagents only with tools the twin has", () => {
    const { tools, agents } = buildToolConfig({});
    for (const def of Object.values(agents ?? {})) {
      for (const t of def.tools ?? []) expect(tools).toContain(t);
    }
  });
});

describe("native permission deny rules", () => {
  it("are passed as flag-layer settings on every base run", () => {
    const opts = buildBaseOptions({ surface: "chat", runId: "r", employeeId: ME });
    const deny = (opts.settings as { permissions?: { deny?: string[] } }).permissions?.deny;
    expect(deny).toEqual(twinPermissionDenyRules());
    expect(opts.disallowedTools).toEqual(TWIN_HARD_DISALLOWED);
  });

  it("cover memory, auth, invites, stored secrets, .env and the home config dirs", () => {
    const rules = twinPermissionDenyRules(HOME);
    for (const tool of ["Read", "Edit"]) {
      expect(rules).toContain(`${tool}(/${DATA}/memory/**)`);
      expect(rules).toContain(`${tool}(/${DATA}/auth/**)`);
      expect(rules).toContain(`${tool}(/${DATA}/invites.json)`);
      expect(rules).toContain(`${tool}(/${APP}/.env*)`);
      expect(rules).toContain(`${tool}(~/.claude/**)`);
      expect(rules).toContain(`${tool}(~/.ssh/**)`);
      expect(rules).toContain(`${tool}(/${HOME}/.ssh/**)`);
    }
    const reads = rules.filter((r) => r.startsWith("Read("));
    const denied = (abs: string) => reads.some((r) => ruleMatches(r, abs));
    expect(denied(`${DATA}/memory/other-twin/facts.json`)).toBe(true);
    expect(denied(`${DATA}/auth/sessions.json`)).toBe(true);
    expect(denied(`${DATA}/org/custom-mcp.json`)).toBe(true);
    expect(denied(`${APP}/.env.local`)).toBe(true);
    expect(denied(`${HOME}/.claude/.credentials.json`)).toBe(true);
    expect(denied(`${HOME}/.ssh/id_ed25519`)).toBe(true);
  });

  it("don't match anything a twin legitimately reads", () => {
    const reads = twinPermissionDenyRules(HOME).filter((r) => r.startsWith("Read("));
    const legit = [
      `${DATA}/employees/${ME}/CONTEXT.md`,
      `${DATA}/employees/${ME}/knowledge/notes.md`,
      ...[...PEER_PROFILE_FILES].map((f) => `${DATA}/employees/dana-katz/${f}`),
      `${DATA}/org-brain/nodes/pricing.md`,
      `${DATA}/org-skills/onboarding.md`,
      `${DATA}/scratch/${ME}/memo.md`,
      `${DATA}/org/identity.json`,
      `${HOME}/projects/acme/README.md`,
      `${APP}/README.md`,
    ];
    for (const abs of legit) expect(reads.filter((r) => ruleMatches(r, abs))).toEqual([]);
  });

  it("are a subset of what the read-scope hook already refuses", () => {
    for (const entry of TWIN_DENIED_DATA_PATHS) {
      const rel = entry.endsWith("/") ? `${entry}x.json` : entry;
      expect(isDeniedDataPath(rel)).toBe(true);
      expect(checkTwinRead("Read", { file_path: rel }, ME, DATA).ok).toBe(false);
    }
    expect(isDeniedDataPath("memoryx")).toBe(false);
    expect(isDeniedDataPath(`employees/${ME}/memory/x.md`)).toBe(false);
  });

  it("skip a path the rule syntax would misread, rather than emit a broken rule", () => {
    process.env.EMPLOYEE001_HOME = "/srv/e001 (copy)";
    const rules = twinPermissionDenyRules(HOME);
    expect(rules.some((r) => r.includes("(copy)"))).toBe(false);
    expect(rules).toContain("Read(~/.claude/**)");
  });
});
