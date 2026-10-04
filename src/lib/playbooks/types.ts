import { z } from "zod";

export const PlaybookModeSchema = z.enum(["meeting", "single", "report"]);
export const PlaybookInputSchema = z.object({
  key: z.string().min(1).regex(/^[a-z][a-z0-9_]*$/),
  label: z.string().min(1),
  kind: z.enum(["text", "goal", "week"]),
}).strict();
export const PlaybookSchemaName = z.enum(["verdict", "retro", "brief", "health"]);
export const PlaybookSinkSchema = z.enum(["feed", "approval", "knowledge_proposal", "goal_update", "scratch_doc"]);
export const ParticipantSchema = z.union([
  z.literal("all"),
  z.array(z.string().min(1)).min(1),
  z.object({ role: z.string().min(1).optional(), department: z.string().min(1).optional() }).refine((v) => Boolean(v.role || v.department)),
]);

export const PlaybookSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  icon: z.string().min(1),
  participants: ParticipantSchema,
  mode: PlaybookModeSchema,
  inputs: z.array(PlaybookInputSchema),
  context: z.array(z.enum(["week_digest", "goal_chain", "pending_approvals", "recent_decisions"])),
  prompt: z.string().min(1),
  outputSchema: PlaybookSchemaName,
  sinks: z.array(PlaybookSinkSchema),
  schedule: z.string().min(1).optional(),
  budgetUsd: z.number().finite().positive(),
}).strict();

export type Playbook = z.infer<typeof PlaybookSchema>;
export type PlaybookInput = z.infer<typeof PlaybookInputSchema>;
export type PlaybookSink = z.infer<typeof PlaybookSinkSchema>;
export type PlaybookOutputSchemaName = z.infer<typeof PlaybookSchemaName>;
export type PlaybookKind = "builtin" | "custom";
export type PlaybookRecord = Playbook & { kind: PlaybookKind; createdAt?: string; updatedAt?: string };

export const OutputSchemas = {
  verdict: z.object({ verdict: z.enum(["go", "change", "stop"]), reasons: z.array(z.string()).min(1) }).strict(),
  retro: z.object({ wins: z.array(z.string()), misses: z.array(z.string()), changes: z.array(z.string()).max(3) }).strict(),
  brief: z.object({ title: z.string().min(1), summary: z.string().min(1), nextSteps: z.array(z.string()) }).strict(),
  health: z.object({ status: z.enum(["ok", "attention"]), checks: z.array(z.object({ name: z.string(), status: z.enum(["ok", "warn"]), detail: z.string() }).strict()) }).strict(),
} as const;

export type PlaybookOutput = z.infer<(typeof OutputSchemas)[PlaybookOutputSchemaName]>;

/** A tiny fixture playbook only. E-126 owns real owner-playbook prompts. */
export const BUILTIN_PLAYBOOKS: readonly Playbook[] = [{
  id: "example-brief",
  name: "Example brief",
  description: "Small built-in used by engine tests.",
  icon: "sparkles",
  participants: "all",
  mode: "single",
  inputs: [{ key: "topic", label: "Topic", kind: "text" }],
  context: [],
  prompt: "Return a concise brief about {{inputs.topic}}.",
  outputSchema: "brief",
  sinks: [],
  budgetUsd: 0.1,
}];
