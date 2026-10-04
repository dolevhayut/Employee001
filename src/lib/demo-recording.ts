import { z } from "zod";

/**
 * The deliberately small subset of CouncilEvent used by the zero-key demo.
 * Keeping this separate from the full live-event union makes the checked-in
 * recording reviewable and ensures a demo can never replay an action event.
 */
const EmployeeStartEventSchema = z.object({
  type: z.literal("employee_start"),
  employeeId: z.string().min(1),
  employeeName: z.string().min(1),
}).strict();

const TextDeltaEventSchema = z.object({
  type: z.literal("text_delta"),
  employeeId: z.string().min(1),
  delta: z.string().min(1),
  ts: z.number().nonnegative(),
}).strict();

const EmployeeDoneEventSchema = z.object({
  type: z.literal("employee_done"),
  employeeId: z.string().min(1),
  confidence: z.number().min(0).max(1),
  turns: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative(),
  stoppedReason: z.literal("natural").optional(),
  ts: z.number().nonnegative(),
}).strict();

const CouncilDoneEventSchema = z.object({ type: z.literal("council_done") }).strict();

export const DemoCouncilEventSchema = z.discriminatedUnion("type", [
  EmployeeStartEventSchema,
  TextDeltaEventSchema,
  EmployeeDoneEventSchema,
  CouncilDoneEventSchema,
]);

export const DemoRecordingSchema = z.object({
  version: z.literal(1),
  question: z.string().min(1).max(500),
  participantIds: z.array(z.string().min(1)).min(1).max(5),
  events: z.array(z.object({
    dtMs: z.number().int().nonnegative(),
    event: DemoCouncilEventSchema,
  }).strict()).min(1),
}).strict();

export type DemoRecording = z.infer<typeof DemoRecordingSchema>;
export type DemoCouncilEvent = z.infer<typeof DemoCouncilEventSchema>;

/** Parse untrusted JSON before it is used for a demo replay. */
export function parseRecording(input: unknown): DemoRecording {
  return DemoRecordingSchema.parse(input);
}
