import { z } from "zod";

/**
 * The recorded Ask answers of the zero-key demo (bin/demo/ask.json), replayed
 * by /api/twin/chat instead of a model call. Like the meeting recording, only
 * a small subset of the live trace events is allowed: reading the profile or
 * the handover notes, and the answer text. A replay can never run a tool.
 */
const ts = z.number().nonnegative();

const ToolCallSchema = z.object({
  type: z.literal("tool_call"),
  name: z.literal("Read"),
  args: z.object({ file_path: z.string().regex(/^\/(profile|handover|knowledge)\/[A-Za-z0-9._-]+$/) }).strict(),
  ts,
}).strict();

const ToolResultSchema = z.object({
  type: z.literal("tool_result"),
  name: z.literal("result"),
  summary: z.string().max(200),
  files: z.array(z.string()).max(0),
  ts,
}).strict();

const TextDeltaSchema = z.object({ type: z.literal("text_delta"), delta: z.string().min(1), ts }).strict();

const DoneSchema = z.object({
  type: z.literal("done"),
  confidence: z.number().min(0).max(1),
  cited_files: z.array(z.string()).max(9),
  ts,
}).strict();

export const DemoAskEventSchema = z.discriminatedUnion("type", [ToolCallSchema, ToolResultSchema, TextDeltaSchema, DoneSchema]);

const DemoAskAnswerSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,64}$/),
  employeeId: z.string().regex(/^[a-z0-9_][a-z0-9_-]{1,63}$/),
  question: z.string().min(1).max(300),
  /** The answer spoken in the twin's voice, relative to ask.json. */
  audio: z.object({ file: z.string().regex(/^ask-audio\/[a-z0-9-]{1,64}\.mp3$/), voiceId: z.string().max(64).optional() }).strict().optional(),
  events: z.array(z.object({ dtMs: z.number().int().nonnegative().max(5000), event: DemoAskEventSchema }).strict()).min(2),
}).strict().refine((a) => a.events.at(-1)?.event.type === "done", { message: "A recorded answer ends with done." });

export const DemoAskRecordingSchema = z.object({
  version: z.literal(1),
  answers: z.array(DemoAskAnswerSchema).min(1).max(8),
}).strict();

export type DemoAskRecording = z.infer<typeof DemoAskRecordingSchema>;
export type DemoAskAnswer = DemoAskRecording["answers"][number];
export type DemoAskEvent = z.infer<typeof DemoAskEventSchema>;

/** Parse untrusted JSON before it is used for a demo replay. */
export function parseAskRecording(input: unknown): DemoAskRecording {
  return DemoAskRecordingSchema.parse(input);
}

/** What anything outside the recording gets in the demo, instead of a model call. */
export const DEMO_ASK_FALLBACK =
  "In the demo, try one of the suggested questions, or run `npx employee001 demo --live` with a key to ask your own, or `npx employee001` in an empty folder to set up your own team.";

/**
 * A question as the person meant it: Ask appends an answer-style note after a
 * blank line, and case, punctuation and spacing don't matter.
 */
export function normalizeDemoQuestion(question: string): string {
  return question
    .split("\n\n(")[0]
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^\p{L}\p{N}%' ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The recorded answer to this question from this twin, if there is one. */
export function findDemoAnswer(recording: DemoAskRecording, employeeId: string | undefined, question: string): DemoAskAnswer | null {
  const asked = normalizeDemoQuestion(question);
  return recording.answers.find((a) => a.employeeId === employeeId && normalizeDemoQuestion(a.question) === asked) ?? null;
}
