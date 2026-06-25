// Shared Agent SDK defaults applied to every twin runtime entry point.
// Centralizes feature flags so we don't drift between twin-builder and
// council-runner. See docs/AGENT-SDK-COVERAGE.md for the full rationale.

import type {
  EffortLevel,
  HookCallback,
  HookEvent,
  HookCallbackMatcher,
  Options,
  PostToolUseHookInput,
  PreToolUseHookInput,
  SdkBeta,
  StopHookInput,
  NotificationHookInput,
} from "@anthropic-ai/claude-agent-sdk";
import { appendAuditEntry } from "@/lib/audit-log";

const PKG_VERSION = "Employee001/0.2.0";

/** Models we know about. Keep in lock-step with the dropdown in /settings. */
export const TWIN_MODEL_PRIMARY = "claude-sonnet-4-6";
export const TWIN_MODEL_FALLBACK = "claude-sonnet-4-5";
export const TWIN_MODEL_OPUS = "claude-opus-4-8";

/** Tools we never want a twin to call, ever. Removes them from the model's
 *  context entirely (smaller prompt, clearer intent, no Bash escape hatch).
 *  WebSearch / WebFetch were previously here but the CEO opted into web
 *  research after the v0.4 brain ship — twins can now look things up online. */
export const TWIN_HARD_DISALLOWED: string[] = [
  "Bash",
  "NotebookEdit",
  "EnterWorktree",
  "ExitWorktree",
];

export type TwinSurfaceKind = "builder" | "chat" | "meeting" | "routine" | "relay";

export type BaseOptionsArgs = {
  /** What kind of run this is — selects effort + max-tokens defaults. */
  surface: TwinSurfaceKind;
  /** When set, the SDK becomes interruptible via `controller.abort()`. */
  abortController?: AbortController;
  /** Per-run identifier propagated into hook audit entries. */
  runId: string;
  /** Employee id for audit + error scoping. */
  employeeId: string;
  /** Optional human title shown in `listSessions()`. */
  title?: string;
  /** Override the primary model (CEO can pick Opus for a single message). */
  modelOverride?: string;
};

/**
 * Build the slice of `Options` shared across every `query()` call we make.
 * Caller spreads this and adds per-surface bits (mcpServers, allowedTools,
 * systemPrompt, canUseTool, prompt-specific maxTurns/maxBudgetUsd…).
 *
 * Returned shape is intentionally narrow — anything that varies between
 * builder/chat/meeting stays at the call site.
 */
export function buildBaseOptions(args: BaseOptionsArgs): Pick<
  Options,
  | "model"
  | "fallbackModel"
  | "effort"
  | "thinking"
  | "disallowedTools"
  | "betas"
  | "env"
  | "abortController"
  | "title"
  | "promptSuggestions"
  | "agentProgressSummaries"
  | "strictMcpConfig"
> {
  const effort: EffortLevel =
    args.surface === "builder" || args.surface === "relay"
      ? "high"
      : args.surface === "routine"
        ? "low"
        : "medium";

  // Sonnet 4.6 supports adaptive thinking — let the model decide depth.
  const thinking: Options["thinking"] = { type: "adaptive" };

  // 1M-token context for very long meetings (Sonnet 4.x only).
  const enable1m = process.env.TWIN_ENABLE_1M_CONTEXT === "1";
  const betas: SdkBeta[] | undefined = enable1m
    ? (["context-1m-2025-08-07"] as SdkBeta[])
    : undefined;

  return {
    model: args.modelOverride ?? TWIN_MODEL_PRIMARY,
    fallbackModel: TWIN_MODEL_FALLBACK,
    effort,
    thinking,
    disallowedTools: TWIN_HARD_DISALLOWED,
    betas,
    env: {
      ...process.env,
      CLAUDE_AGENT_SDK_CLIENT_APP: PKG_VERSION,
    },
    abortController: args.abortController,
    title: args.title,
    // Predicted follow-ups in chat surfaces — free (rides parent prompt cache).
    promptSuggestions: args.surface === "chat" || args.surface === "meeting",
    // No effect until programmatic subagents land, but harmless to keep on.
    agentProgressSummaries: false,
    strictMcpConfig: true,
  };
}

// ─── Hooks factory ───────────────────────────────────────────────────────────

export type TwinHookContext = {
  runId: string;
  employeeId: string;
  employeeName: string;
  surface: TwinSurfaceKind;
  /** Forward Notification events to the UI's SSE channel. */
  onNotification?: (n: { kind: string; message: string; title?: string }) => void;
  /** Fire once when the agent loop ends (cleaner than parsing the result msg). */
  onStop?: (info: { stoppedBy: "natural" | "max_turns" | "user_abort" }) => void;
};

/**
 * Standard hook bundle: PostToolUse → audit, Notification → UI, Stop → callback.
 * Compose with any custom hooks at the call site (`{ ...buildHooks(ctx),
 * UserPromptSubmit: [...] }`).
 */
export function buildTwinHooks(
  ctx: TwinHookContext
): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
  const auditPostToolUse: HookCallback = async (input) => {
    if (input.hook_event_name !== "PostToolUse") return {};
    const post = input as PostToolUseHookInput;
    const toolInput = (post.tool_input ?? {}) as Record<string, unknown>;
    const bare = post.tool_name.replace(/^mcp__[a-z0-9_]+__/i, "");
    // BaseHookInput carries agent_id / agent_type when fired inside a subagent.
    const baseInput = post as unknown as { agent_id?: string; agent_type?: string };
    try {
      appendAuditEntry({
        runId: ctx.runId,
        employeeId: ctx.employeeId,
        employeeName: ctx.employeeName,
        toolName: post.tool_name,
        bareName: bare,
        input: toolInput,
        verdict: "executed",
        durationMs: post.duration_ms,
        ...(baseInput.agent_id ? { agentId: baseInput.agent_id } : {}),
        ...(baseInput.agent_type ? { agentType: baseInput.agent_type } : {}),
      });
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      console.warn(`[twin-hooks] audit append failed: ${m}`);
    }
    return {};
  };

  // Inject a citation note after WebSearch / WebFetch so the model knows
  // to cite the URL and fetch date in its answer. Uses additionalContext
  // (appended to the tool result, visible to model only — not in the UI).
  const injectWebCitation: HookCallback = async (input) => {
    if (input.hook_event_name !== "PostToolUse") return {};
    const post = input as PostToolUseHookInput;
    if (post.tool_name !== "WebSearch" && post.tool_name !== "WebFetch") return {};

    const toolInput = (post.tool_input ?? {}) as Record<string, unknown>;
    const fetchedAt = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
    const url = typeof toolInput.url === "string" ? toolInput.url : null;
    const citation = url
      ? `[Fetched from ${url} on ${fetchedAt}. Cite this URL and date in your answer so the CEO can verify the source.]`
      : `[Web results fetched on ${fetchedAt}. Cite the source URL(s) and date in your answer.]`;

    return {
      hookSpecificOutput: {
        hookEventName: "PostToolUse" as const,
        additionalContext: citation,
      },
    };
  };

  const forwardNotification: HookCallback = async (input) => {
    if (input.hook_event_name !== "Notification") return {};
    const note = input as NotificationHookInput;
    try {
      ctx.onNotification?.({
        kind: note.notification_type,
        message: note.message,
        title: note.title,
      });
    } catch {
      /* notification forwarding is best-effort */
    }
    return {};
  };

  const onStopHook: HookCallback = async (input) => {
    if (input.hook_event_name !== "Stop") return {};
    const stop = input as StopHookInput;
    try {
      ctx.onStop?.({
        stoppedBy: stop.stop_hook_active ? "natural" : "natural",
      });
    } catch {
      /* best-effort */
    }
    return {};
  };

  // Block hard-disallowed tools defensively even if a future config change
  // would otherwise let them through. (disallowedTools removes them from
  // context, but a permissive settings.json could re-enable.)
  const blockHardDisallowed: HookCallback = async (input) => {
    if (input.hook_event_name !== "PreToolUse") return {};
    const pre = input as PreToolUseHookInput;
    if (TWIN_HARD_DISALLOWED.includes(pre.tool_name)) {
      return {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: `${pre.tool_name} is hard-disallowed for twins (see sdk-defaults.ts).`,
        },
      };
    }
    return {};
  };

  // Restrict the Write tool to the per-twin scratch directory. Twins can
  // jot down notes / draft memos / save observations there, but they can't
  // overwrite their own profile, brain nodes, or anything else under data/.
  // Path is relative to the agent's cwd (set to data/ in council-runner).
  const restrictWriteToScratch: HookCallback = async (input) => {
    if (input.hook_event_name !== "PreToolUse") return {};
    const pre = input as PreToolUseHookInput;
    if (pre.tool_name !== "Write") return {};
    const toolInput = (pre.tool_input ?? {}) as { file_path?: unknown };
    const rawPath =
      typeof toolInput.file_path === "string" ? toolInput.file_path : "";

    const deny = (reason: string) => {
      console.warn(`[restrictWriteToScratch] DENIED — ${reason} (raw: "${rawPath}")`);
      try {
        appendAuditEntry({
          runId: ctx.runId,
          employeeId: ctx.employeeId,
          employeeName: ctx.employeeName,
          toolName: "Write",
          bareName: "Write",
          input: { file_path: rawPath },
          verdict: "hard_blocked",
          blockReason: reason,
        });
      } catch { /* audit must not crash the run */ }
      ctx.onNotification?.({
        kind: "write_denied",
        message: reason,
        title: "Scratch write denied",
      });
      return {
        hookSpecificOutput: {
          hookEventName: "PreToolUse" as const,
          permissionDecision: "deny" as const,
          permissionDecisionReason: reason,
        },
      };
    };

    if (!rawPath) {
      return deny("Write requires a file_path.");
    }

    const allowedPrefix = `scratch/${ctx.employeeId}/`;

    // Normalise: strip leading ./ and convert backslashes.
    let normalized = rawPath.replace(/^\.\//, "").replace(/\\/g, "/");

    // The Agent SDK reports its cwd as an absolute path, and some models will
    // compose the full absolute path (e.g. /Users/…/data/scratch/dolev-hayut/memo.md)
    // instead of the relative form. If the path contains our allowed prefix
    // anywhere, extract the relative portion and rewrite the input so the SDK
    // uses the correctly-scoped path. This avoids spurious denials.
    const scratchIdx = normalized.indexOf(allowedPrefix);
    if (scratchIdx > 0) {
      // Rewrite absolute path → relative path by slicing from "scratch/<id>/"
      normalized = normalized.slice(scratchIdx);
    }

    // Strip a leading "data/" if the agent mistakenly prepended the cwd name.
    normalized = normalized.replace(/^data\//, "");

    const ok =
      normalized.startsWith(allowedPrefix) &&
      !normalized.includes("..") &&
      // Disallow hidden file names defensively.
      !normalized.split("/").some((seg) => seg.startsWith("."));

    if (!ok) {
      return deny(
        `Write is sandboxed to ${allowedPrefix}<filename>. Got: "${rawPath}" (normalised: "${normalized}"). ` +
        `Use a relative path like scratch/${ctx.employeeId}/my-memo.md`
      );
    }

    // Ensure the scratch dir exists so the SDK's Write doesn't fail on first use.
    try {
      const fs = await import("fs");
      const path = await import("path");
      const fullDir = path.join(
        process.cwd(),
        "data",
        "scratch",
        ctx.employeeId
      );
      fs.mkdirSync(fullDir, { recursive: true });
    } catch {
      /* best-effort — if mkdir fails, the SDK Write will surface the real error */
    }

    console.log(`[restrictWriteToScratch] ALLOWED — "${normalized}" (original: "${rawPath}")`);

    // If the path was rewritten (absolute → relative), propagate the corrected
    // input so the SDK's Write tool uses the right relative path.
    if (normalized !== rawPath.replace(/^\.\//, "").replace(/\\/g, "/")) {
      return {
        hookSpecificOutput: {
          hookEventName: "PreToolUse" as const,
          permissionDecision: "allow" as const,
          updatedInput: { ...toolInput, file_path: normalized },
        },
      };
    }

    return {};
  };

  return {
    PreToolUse: [{ hooks: [blockHardDisallowed, restrictWriteToScratch] }],
    PostToolUse: [{ hooks: [auditPostToolUse, injectWebCitation] }],
    Notification: [{ hooks: [forwardNotification] }],
    Stop: [{ hooks: [onStopHook] }],
  };
}
