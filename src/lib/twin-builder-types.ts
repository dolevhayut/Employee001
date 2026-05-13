// Client-safe types & constants for the Twin Builder runner.
// IMPORTANT: this module must not import any server-only code (composio,
// fs, claude-agent-sdk). The full runner lives in `twin-builder.ts`.

export const TWIN_FILE_NAMES = [
  "CONTEXT.md",
  "EXPERTISE.md",
  "PROJECTS.md",
  "PEOPLE.md",
  "DECISIONS.md",
  "PREFERENCES.md",
  "TONE.md",
  "BOUNDARIES.md",
  "EMPLOYMENT.md",
] as const;

export type TwinFileName = (typeof TWIN_FILE_NAMES)[number];

export type TwinBuilderEvent =
  | { type: "start"; employeeId: string; activeToolkits: string[]; ts: number }
  | { type: "plan"; text: string; ts: number }
  | { type: "tool_use"; tool: string; input: unknown; ts: number }
  | { type: "tool_result"; tool: string; ts: number }
  | { type: "text_delta"; delta: string; ts: number }
  | {
      type: "file_writing";
      filename: TwinFileName;
      content: string;
      ts: number;
    }
  | {
      type: "file_done";
      filename: TwinFileName;
      sizeBytes: number;
      ts: number;
    }
  | { type: "file_blocked"; filename: string; reason: string; ts: number }
  | { type: "tool_blocked"; tool: string; reason: string; ts: number }
  | { type: "error"; message: string; ts: number }
  | {
      /** Structured manifest from the SDK's `outputFormat`, validated against
       *  our JSON schema. Emitted on the `result` message right before `done`. */
      type: "build_manifest";
      manifest: {
        files: Array<{
          filename: TwinFileName;
          confidence: "high" | "medium" | "low";
          sources: string[];
          summary?: string;
        }>;
        overallConfidence: "high" | "medium" | "low";
        notes?: string;
      };
      ts: number;
    }
  | {
      /** Emitted right after a build manifest is written, before `done`. */
      type: "build_recorded";
      buildId: string;
      version: number;
      filesInManifest: TwinFileName[];
      ts: number;
    }
  | {
      type: "done";
      filesWritten: TwinFileName[];
      turns: number;
      costUsd: number;
      stoppedReason: "max_budget" | "max_turns" | "natural" | "no_connections";
      ts: number;
    };
