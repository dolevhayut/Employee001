import { z } from "zod";

export const ShiftReport = z.object({
  summary: z.string().describe("One short line of what happened this shift."),
  contextUpdate: z
    .string()
    .optional()
    .describe("One paragraph the twin wants to remember next shift."),
  decisions: z
    .array(
      z.object({
        text: z.string(),
        rationale: z.string().optional(),
      })
    )
    .optional(),
  learnings: z.array(z.string()).optional(),
  goalUpdates: z
    .array(
      z.object({
        departmentId: z.string(),
        metric: z.string(),
        increment: z.number().int(),
      })
    )
    .optional(),
  tasksCreate: z
    .array(
      z.object({
        toTwinId: z.string().optional(),
        toDepartmentId: z.string().optional(),
        title: z.string(),
        description: z.string().optional(),
        priority: z.number().int().min(1).max(5).default(3),
      })
    )
    .optional(),
  tasksComplete: z
    .array(
      z.object({
        taskId: z.string(),
        result: z.string(),
      })
    )
    .optional(),
  feedItems: z
    .array(
      z.object({
        kind: z.enum(["update", "alert", "needs-review"]),
        title: z.string(),
        detail: z.string().optional(),
        priority: z.number().int().min(1).max(5).default(3),
      })
    )
    .optional()
    .describe("Items the twin wants to surface to the CEO in /flow."),
  artifacts: z
    .array(z.string())
    .optional()
    .describe("Relative paths the twin created or modified."),
  outputs: z
    .array(
      z.object({
        kind: z.enum(["image", "video", "file", "link", "text"]).optional(),
        title: z.string(),
        url: z.string().optional(),
        path: z.string().optional(),
        note: z.string().optional(),
      })
    )
    .optional()
    .describe(
      "Every concrete deliverable you produced this shift — generated image/video URLs, created files, published links. Always list them here so the CEO has a clean record of what came out of the shift."
    ),
});

export type ShiftReportType = z.infer<typeof ShiftReport>;

// Why sanitize: z.toJSONSchema() emits Draft 2020-12 JSON Schema with `$schema`
// declared and `.int()` fields wrapped in safe-int min/max bounds. Claude's
// structured-output validator silently rejects both, falls into retry loop,
// then returns `structured_output: undefined`. Strip the dialect marker and
// the auto-injected int bounds before handing to the SDK.
function sanitizeForAnthropic(schema: unknown): Record<string, unknown> {
  const cloned = JSON.parse(JSON.stringify(schema)) as Record<string, unknown>;
  walk(cloned);
  return cloned;

  function walk(node: unknown): void {
    if (!node || typeof node !== "object") return;
    const obj = node as Record<string, unknown>;
    delete obj.$schema;
    if (obj.type === "integer") {
      if (obj.minimum === Number.MIN_SAFE_INTEGER) delete obj.minimum;
      if (obj.maximum === Number.MAX_SAFE_INTEGER) delete obj.maximum;
    }
    for (const k of Object.keys(obj)) {
      const v = obj[k];
      if (Array.isArray(v)) v.forEach(walk);
      else walk(v);
    }
  }
}

export const SHIFT_REPORT_JSON_SCHEMA = sanitizeForAnthropic(z.toJSONSchema(ShiftReport));
