import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { EmployeeWithTwin } from "@/lib/employees";
import {
  readSharedFile,
  readSharedFileBytes,
  recordSharedFile,
  SHARED_FILE_MAX_BYTES,
  type SharedFile,
} from "@/lib/meeting-store";
import { analyzeCsv, queryCsv, type QuerySpec } from "@/lib/csv-analysis";

/**
 * Claude vision API caps per-image dimensions and total bytes; well-formed
 * common images stay safely under this. We pre-validate so the agent gets
 * a clear error instead of a downstream API failure.
 */
const VISION_MAX_BYTES = 10 * 1024 * 1024;

/** Image MIME types the meeting scratch will accept from sourceUrl fetches. */
const ALLOWED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/webp",
]);

/**
 * Text MIME types accepted from sourceUrl. Drive / S3 frequently return
 * `application/octet-stream` for ambiguous files — we fall back to the
 * filename extension when the upstream content-type isn't decisive.
 */
const ALLOWED_TEXT_TYPES = new Set([
  "text/csv",
  "text/plain",
  "text/markdown",
  "text/tab-separated-values",
  "text/html",
  "text/xml",
  "application/json",
  "application/xml",
  "application/x-yaml",
  "text/yaml",
  "application/octet-stream", // fall through to extension check
]);

const TEXT_EXTENSIONS = new Set([
  "csv", "tsv", "json", "md", "markdown", "txt", "log", "yaml", "yml", "xml", "html", "htm",
]);

function looksLikeTextByExtension(filename: string): boolean {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return TEXT_EXTENSIONS.has(ext);
}

/** Block obvious SSRF targets — private/loopback IPv4 ranges. */
function isPrivateIPv4(host: string): boolean {
  const m = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return false;
  const a = parseInt(m[1], 10);
  const b = parseInt(m[2], 10);
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 0) return true;
  return false;
}

/**
 * Fetch a URL into memory with hard guardrails:
 * - https/http only, no localhost / RFC1918 IPv4
 * - 30s timeout
 * - response size capped at SHARED_FILE_MAX_BYTES
 * - content-type validated against an explicit allowlist
 */
async function fetchUrlAsBytes(
  rawUrl: string,
  allowedTypes: Set<string>
): Promise<{ bytes: Buffer; contentType: string }> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("invalid URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("only http(s) URLs allowed");
  }
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host === "::1" || isPrivateIPv4(host)) {
    throw new Error("private / loopback hosts blocked");
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000);
  let res: Response;
  try {
    res = await fetch(rawUrl, { signal: ctrl.signal, redirect: "follow" });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} from upstream`);

  const ct = (res.headers.get("content-type") ?? "")
    .toLowerCase()
    .split(";")[0]
    .trim();
  if (!allowedTypes.has(ct)) {
    throw new Error(
      `content-type "${ct}" not allowed (expected one of: ${[...allowedTypes].join(", ")})`
    );
  }

  const ab = await res.arrayBuffer();
  if (ab.byteLength > SHARED_FILE_MAX_BYTES) {
    throw new Error(
      `response is ${ab.byteLength} bytes, exceeds ${SHARED_FILE_MAX_BYTES} limit`
    );
  }
  return { bytes: Buffer.from(ab), contentType: ct };
}

/**
 * Optional callback fired immediately after a successful `share_with_meeting`.
 * The runner uses it to emit a `file_shared` UI event without racing the
 * Agent SDK's message stream (the handler runs *between* yields, so the
 * `assistant` tool_use block is observed before the file is persisted).
 */
export type OnSharedCallback = (entry: SharedFile) => void;

/**
 * In-process MCP server exposing the "meeting scratch" — a per-meeting
 * shared workspace where twins can drop files they've pulled from
 * connected services (Drive, GitHub, Slack, etc.) and let other twins
 * reference them by filename instead of re-pulling or paying the prompt
 * cost twice.
 *
 * Two tools, both closure-bound to a specific meeting and a specific
 * "speaking" twin so we always know who shared what:
 *
 *   - `share_with_meeting` — write a text file into the meeting scratch
 *   - `read_meeting_file`  — pull the full content back by filename
 *
 * The runner intercepts `share_with_meeting` tool_use events to emit a
 * dedicated `file_shared` UI event (analogous to the artifact pipeline);
 * the handler itself just persists and returns confirmation.
 */
export function buildMeetingScratchMcpServer(
  meetingId: string,
  employee: EmployeeWithTwin,
  onShared?: OnSharedCallback
) {
  return createSdkMcpServer({
    name: "meeting_scratch",
    version: "1.0.0",
    tools: [
      tool(
        "share_with_meeting",
        [
          "Drop a file into the shared meeting scratch so other twins (and the CEO) can see it.",
          "Three input modes — pick exactly one:",
          "(1) TEXT INLINE — pass `content` with the full text body (CSV / JSON / Markdown / plain text). Use when you already have the body in memory.",
          "(2) URL DOWNLOAD — pass `sourceUrl` (e.g. presigned URL from `GOOGLEDRIVE_DOWNLOAD_FILE`). The server fetches the URL and stores the bytes. Works for both text files (CSV/JSON/MD/TXT) AND images (PNG/JPEG/GIF/WebP). Use this for anything you got from a Composio download — DO NOT WebFetch it first.",
          "Other twins can `read_meeting_file` text bodies; for images they see only filename + summary (or call `view_meeting_image` for vision).",
          "Pick a descriptive filename including extension — `q1-pipeline.csv`, `homepage-mock.png` — never `data.csv` or `image.png`.",
          "Write a tight one-line summary: what's in this file, when would another twin care.",
          "Hard limit: 25 MB.",
        ].join(" "),
        {
          filename: z
            .string()
            .min(1)
            .max(120)
            .describe(
              "Descriptive filename including extension, e.g. `q1-pipeline.csv`, `homepage-mock.png`. Sanitized; collisions get a `_2` suffix."
            ),
          summary: z
            .string()
            .min(4)
            .max(240)
            .describe(
              "One-line description shown to other twins. Answer: what's in this file, and when would I care?"
            ),
          content: z
            .string()
            .optional()
            .describe(
              "TEXT INLINE mode: full text body of the file. CSV / JSON / Markdown / plain text only. Mutually exclusive with sourceUrl."
            ),
          sourceUrl: z
            .string()
            .url()
            .optional()
            .describe(
              "URL DOWNLOAD mode: https URL the server should fetch. Works for text files (CSV/JSON/MD/TXT) and images (PNG/JPEG/GIF/WebP). Server detects type from response Content-Type, falling back to filename extension. Pass presigned URLs directly from Composio download tools — do NOT WebFetch them first. Mutually exclusive with content."
            ),
        },
        async (input) => {
          try {
            const hasContent = typeof input.content === "string" && input.content.length > 0;
            const hasSourceUrl = typeof input.sourceUrl === "string" && input.sourceUrl.length > 0;
            if (hasContent && hasSourceUrl) {
              throw new Error("pass exactly one of `content` or `sourceUrl`, not both");
            }
            if (!hasContent && !hasSourceUrl) {
              throw new Error("must pass either `content` or `sourceUrl`");
            }

            let entry: SharedFile;
            if (hasSourceUrl) {
              // Accept image OR text content types from upstream. We try
              // image types first; if the upstream returns a text/* type
              // we re-fetch via the text whitelist (so we get the same
              // SSRF guards but the right kind labelling).
              const wantTextByExt = looksLikeTextByExtension(input.filename);
              const allowed = wantTextByExt
                ? new Set([...ALLOWED_IMAGE_TYPES, ...ALLOWED_TEXT_TYPES])
                : new Set([...ALLOWED_IMAGE_TYPES, ...ALLOWED_TEXT_TYPES]);
              const fetched = await fetchUrlAsBytes(
                input.sourceUrl as string,
                allowed
              );
              const ct = fetched.contentType;
              const isImage = ALLOWED_IMAGE_TYPES.has(ct);
              const isText =
                ALLOWED_TEXT_TYPES.has(ct) ||
                (ct === "application/octet-stream" && wantTextByExt);

              if (isImage && !wantTextByExt) {
                entry = recordSharedFile(meetingId, {
                  kind: "image",
                  filename: input.filename,
                  bytes: fetched.bytes,
                  contentType: ct,
                  summary: input.summary,
                  sharedById: employee.id,
                  sharedByName: employee.firstName,
                });
              } else if (isText) {
                // Decode upstream bytes as UTF-8. If the file claimed an
                // image content-type but the filename hints at text, we
                // still defer to the extension (e.g. octet-stream + .csv).
                const text = fetched.bytes.toString("utf8");
                entry = recordSharedFile(meetingId, {
                  kind: "text",
                  filename: input.filename,
                  content: text,
                  summary: input.summary,
                  sharedById: employee.id,
                  sharedByName: employee.firstName,
                });
              } else {
                throw new Error(
                  `upstream content-type "${ct}" doesn't match the filename. For text files use a .csv/.json/.md/.txt extension; for images use .png/.jpg/.gif/.webp.`
                );
              }
            } else {
              entry = recordSharedFile(meetingId, {
                filename: input.filename,
                content: input.content as string,
                summary: input.summary,
                sharedById: employee.id,
                sharedByName: employee.firstName,
              });
            }

            try {
              onShared?.(entry);
            } catch {
              // Callback errors should not fail the tool call.
            }
            const sizeKb = Math.max(1, Math.round(entry.sizeBytes / 1024));
            const kindLabel =
              entry.kind === "image"
                ? `image (${entry.contentType}, rendered inline for the CEO)`
                : `text`;
            return {
              content: [
                {
                  type: "text",
                  text: `Shared \`${entry.filename}\` (${sizeKb} KB, ${kindLabel}) with the meeting. Colleagues see the filename + summary "${entry.summary}".`,
                },
              ],
            };
          } catch (err) {
            const message = err instanceof Error ? err.message : "Unknown error";
            return {
              content: [
                {
                  type: "text",
                  text: `share_with_meeting failed: ${message}. Limit is ${SHARED_FILE_MAX_BYTES} bytes.`,
                },
              ],
              isError: true,
            };
          }
        }
      ),
      tool(
        "view_meeting_image",
        [
          "Look at an image another twin shared into this meeting — actually see the pixels.",
          "The model receives the image as vision input, so you can comment on its visual qualities (composition, colors, typography, clarity, what's depicted) just like the CEO does when looking at it.",
          "Use this when the CEO asks for your reaction to a visual, your design judgment, or a comparison between visuals — anything where reading filename + summary isn't enough.",
          "Do NOT call this for every image in the meeting. Only call it when the visual itself is what the question is about.",
          "Returns an error if the file is text or doesn't exist; for those use read_meeting_file instead.",
        ].join(" "),
        {
          filename: z
            .string()
            .min(1)
            .describe(
              "Image filename exactly as it appears in the shared-files list (e.g. `enhanced-image-apr25.png`)."
            ),
        },
        async (input) => {
          const result = readSharedFileBytes(meetingId, input.filename);
          if (!result.found) {
            return {
              content: [
                {
                  type: "text",
                  text: `No file named \`${input.filename}\` in this meeting. Check the shared-files list above.`,
                },
              ],
              isError: true,
            };
          }
          const e = result.entry;
          if (e.kind !== "image") {
            return {
              content: [
                {
                  type: "text",
                  text: `\`${e.filename}\` is a ${e.kind} file (${e.contentType}), not an image. Use \`read_meeting_file\` to read its content as text.`,
                },
              ],
              isError: true,
            };
          }
          if (result.bytes.length > VISION_MAX_BYTES) {
            const sizeMb = (result.bytes.length / (1024 * 1024)).toFixed(1);
            return {
              content: [
                {
                  type: "text",
                  text: `\`${e.filename}\` is ${sizeMb} MB — too large to view (limit ${(VISION_MAX_BYTES / (1024 * 1024)).toFixed(0)} MB for vision). The CEO sees the image inline; describe what they showed you using filename + summary.`,
                },
              ],
              isError: true,
            };
          }
          return {
            content: [
              {
                type: "image",
                data: result.bytes.toString("base64"),
                mimeType: e.contentType,
              },
              {
                type: "text",
                text: `(Image \`${e.filename}\` — shared by ${e.sharedByName} — summary: "${e.summary}")`,
              },
            ],
          };
        }
      ),
      tool(
        "read_meeting_file",
        [
          "Read the full text content of a file another twin shared into this meeting.",
          "Works ONLY for text files (CSV / JSON / Markdown / plain text). Do NOT call this on images — images are rendered inline for the CEO and cannot be analyzed as text. The shared-files list in your context labels each file as 'text' or 'image'.",
          "Most of the time the summary in the shared-files list is enough — only call this when you genuinely need the raw data.",
          "Pass the filename exactly as it appears in the shared-files list.",
        ].join(" "),
        {
          filename: z
            .string()
            .min(1)
            .describe("Filename as listed in the shared-files block of your prompt."),
        },
        async (input) => {
          const result = readSharedFile(meetingId, input.filename);
          if (result.status === "not_found") {
            return {
              content: [
                {
                  type: "text",
                  text: `No file named \`${input.filename}\` in this meeting. Check the shared-files list above and use an exact filename.`,
                },
              ],
              isError: true,
            };
          }
          if (result.status === "binary") {
            const e = result.entry;
            return {
              content: [
                {
                  type: "text",
                  text: [
                    `\`${e.filename}\` exists but it is an ${e.kind} (${e.contentType}) — its bytes are NOT readable through this tool.`,
                    `The CEO sees the image rendered inline in the chat. You can refer to it by filename and use the summary "${e.summary}" — do not pretend you can analyze the pixels.`,
                  ].join(" "),
                },
              ],
              isError: true,
            };
          }
          const { entry, content } = result;
          const sizeKb = Math.max(1, Math.round(entry.sizeBytes / 1024));
          return {
            content: [
              {
                type: "text",
                text: [
                  `=== ${entry.filename} (${sizeKb} KB, shared by ${entry.sharedByName}) ===`,
                  `summary: ${entry.summary}`,
                  ``,
                  content,
                ].join("\n"),
              },
            ],
          };
        }
      ),
      tool(
        "analyze_csv",
        [
          "Get a structured overview of a CSV file shared in this meeting — column names, inferred types, row count, numeric stats (min/max/avg/sum), and a 10-row preview.",
          "ALWAYS call this BEFORE `query_csv` so you know what columns and types exist; otherwise you'll guess wrong and waste calls.",
          "Cheap to call — never reads the full body into your context, only the structured summary.",
          "Use this instead of `read_meeting_file` whenever the file is a CSV and you need to reason about the data.",
        ].join(" "),
        {
          filename: z
            .string()
            .min(1)
            .describe("CSV filename exactly as it appears in the shared-files list."),
        },
        async (input) => {
          const result = readSharedFile(meetingId, input.filename);
          if (result.status === "not_found") {
            return {
              content: [{ type: "text", text: `No file named \`${input.filename}\` in this meeting.` }],
              isError: true,
            };
          }
          if (result.status === "binary") {
            return {
              content: [{ type: "text", text: `\`${input.filename}\` is an image, not a CSV. Use \`view_meeting_image\` instead.` }],
              isError: true,
            };
          }
          try {
            const { analysis } = analyzeCsv(result.content);
            // Compact the analysis for prompt-friendly output.
            const colsLine = analysis.columns
              .map((c) => {
                const stats =
                  c.numericStats
                    ? ` [num: min=${c.numericStats.min}, max=${c.numericStats.max}, avg=${c.numericStats.avg.toFixed(2)}, sum=${c.numericStats.sum}]`
                    : c.dateStats
                    ? ` [date: ${c.dateStats.min} → ${c.dateStats.max}]`
                    : "";
                const sampleStr = c.sample.slice(0, 4).map((s) => JSON.stringify(s)).join(", ");
                return `  - ${c.name} (${c.type}, unique=${c.uniqueCount}, nulls=${c.nullCount})${stats}\n    sample: ${sampleStr}`;
              })
              .join("\n");
            const previewStr = analysis.previewRows
              .map((r, i) => `  ${i + 1}. ${JSON.stringify(r)}`)
              .join("\n");
            return {
              content: [
                {
                  type: "text",
                  text: [
                    `=== analyze_csv: ${input.filename} ===`,
                    `rows: ${analysis.rowCount} · bytes: ${analysis.byteSize}`,
                    ``,
                    `columns:`,
                    colsLine,
                    ``,
                    `preview (first ${analysis.previewRows.length} rows):`,
                    previewStr,
                    ``,
                    `Next: call \`query_csv\` with where/groupBy/aggregate/orderBy/limit to compute over the full ${analysis.rowCount} rows. Don't read the raw body — that wastes context.`,
                  ].join("\n"),
                },
              ],
            };
          } catch (err) {
            const message = err instanceof Error ? err.message : "Unknown error";
            return {
              content: [{ type: "text", text: `analyze_csv failed: ${message}` }],
              isError: true,
            };
          }
        }
      ),
      tool(
        "query_csv",
        [
          "Run a structured query over a CSV file — filter rows, group by columns, aggregate numerics, sort, limit. Returns only the result rows as JSON, never the full file body.",
          "Always call `analyze_csv` first so you know the column names and types.",
          "Aggregate operations: { sum: 'col' } | { avg: 'col' } | { min: 'col' } | { max: 'col' } | { count: '*' }.",
          "Where conditions: literal value (eq), or operator object: { gt, gte, lt, lte, ne, in, contains }.",
          "Result is capped at 500 rows; for visualizations or top-N answers, use orderBy + limit.",
        ].join(" "),
        {
          filename: z.string().min(1).describe("CSV filename from the shared-files list."),
          where: z
            .record(z.string(), z.unknown())
            .optional()
            .describe(
              "Optional filter. Each key is a column name. Value is either a literal (matches eq) or an object with operators: { eq, ne, gt, gte, lt, lte, in: [...], contains: 'substring' }."
            ),
          groupBy: z
            .array(z.string())
            .optional()
            .describe("Optional. Columns to group by. Required if `aggregate` is given and you want per-group results."),
          aggregate: z
            .record(
              z.string(),
              z.union([
                z.object({ sum: z.string() }),
                z.object({ avg: z.string() }),
                z.object({ min: z.string() }),
                z.object({ max: z.string() }),
                z.object({ count: z.union([z.literal("*"), z.string()]) }),
              ])
            )
            .optional()
            .describe(
              'Optional. Map of output-column-name → aggregate spec. Example: { totalAmount: { sum: "amount" }, deals: { count: "*" } }.'
            ),
          orderBy: z
            .array(
              z.object({
                column: z.string(),
                dir: z.enum(["asc", "desc"]).optional(),
              })
            )
            .optional()
            .describe("Optional. Sort spec, applied after aggregation."),
          limit: z
            .number()
            .int()
            .positive()
            .max(500)
            .optional()
            .describe("Optional. Max result rows. Hard cap is 500 regardless."),
          select: z
            .array(z.string())
            .optional()
            .describe("Optional. When neither groupBy nor aggregate are used, narrow output to these columns."),
        },
        async (input) => {
          const result = readSharedFile(meetingId, input.filename);
          if (result.status === "not_found") {
            return {
              content: [{ type: "text", text: `No file named \`${input.filename}\`.` }],
              isError: true,
            };
          }
          if (result.status === "binary") {
            return {
              content: [{ type: "text", text: `\`${input.filename}\` is an image, not a CSV.` }],
              isError: true,
            };
          }
          try {
            const { rows, columnTypes } = analyzeCsv(result.content);
            const spec: QuerySpec = {
              where: input.where as QuerySpec["where"],
              groupBy: input.groupBy,
              aggregate: input.aggregate as QuerySpec["aggregate"],
              orderBy: input.orderBy,
              limit: input.limit,
              select: input.select,
            };
            const out = queryCsv(rows, spec);
            const sample = out.rows.slice(0, 50);
            const truncatedSample = out.rows.length > 50;
            return {
              content: [
                {
                  type: "text",
                  text: [
                    `=== query_csv: ${input.filename} ===`,
                    `total matched: ${out.totalMatched}${out.truncated ? " (result truncated to 500)" : ""}`,
                    `result rows: ${out.rows.length}${truncatedSample ? " (showing first 50 in this trace, full set is in your context)" : ""}`,
                    ``,
                    JSON.stringify(sample, null, 2),
                    truncatedSample ? `\n... ${out.rows.length - 50} more rows` : "",
                    ``,
                    `column types (for reference): ${JSON.stringify(columnTypes)}`,
                  ].join("\n"),
                },
              ],
            };
          } catch (err) {
            const message = err instanceof Error ? err.message : "Unknown error";
            return {
              content: [{ type: "text", text: `query_csv failed: ${message}` }],
              isError: true,
            };
          }
        }
      ),
    ],
  });
}

export const SHARE_TOOL_BARE_NAME = "share_with_meeting";
export const READ_TOOL_BARE_NAME = "read_meeting_file";
export const VIEW_IMAGE_TOOL_BARE_NAME = "view_meeting_image";
export const ANALYZE_CSV_TOOL_BARE_NAME = "analyze_csv";
export const QUERY_CSV_TOOL_BARE_NAME = "query_csv";
export const SHARE_TOOL_FULL_NAME = "mcp__meeting_scratch__share_with_meeting";
export const READ_TOOL_FULL_NAME = "mcp__meeting_scratch__read_meeting_file";
export const VIEW_IMAGE_TOOL_FULL_NAME = "mcp__meeting_scratch__view_meeting_image";
export const ANALYZE_CSV_TOOL_FULL_NAME = "mcp__meeting_scratch__analyze_csv";
export const QUERY_CSV_TOOL_FULL_NAME = "mcp__meeting_scratch__query_csv";
