import { appendAuditEntry } from "@/lib/audit-log";
import { listPendingApprovals } from "@/lib/approval-bus";
import { runSingleTwin } from "@/lib/council-runner";
import { loadEmployeesFromDisk } from "@/lib/employees-disk";
import { readEmployeeFile } from "@/lib/employees-files";
import {
  getMeeting,
  listMeetings,
  listSharedFiles,
  renderTranscriptForPrompt,
} from "@/lib/meeting-store";
import { searchOrgBrain } from "@/lib/org-brain-search";
import { isUnderBudget, recordSpend } from "@/lib/twin-budget";
import { takeAskTwinRateLimit } from "./rate-limit";

export const PROFILE_FILES = [
  "EXPERTISE.md",
  "TONE.md",
  "CONTEXT.md",
  "DECISIONS.md",
  "PREFERENCES.md",
  "PEOPLE.md",
  "PROJECTS.md",
  "BOUNDARIES.md",
  "EMPLOYMENT.md",
] as const;

export type ToolName =
  | "list_twins"
  | "get_twin_profile"
  | "search_org_brain"
  | "list_pending_approvals"
  | "list_team_meetings"
  | "get_team_meeting"
  | "ask_twin";
export type ToolResult = {
  content: [{ type: "text"; text: string }];
  isError?: boolean;
};
type ToolArgs = Record<string, unknown>;
type Handler = (args: ToolArgs) => Promise<ToolResult>;

const TRANSCRIPT_LIMIT_BYTES = 64 * 1024;

function text(value: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function fail(error: string, message: string): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify({ error, message }) }],
    isError: true,
  };
}

function cap(value: string, length: number): string {
  return value.length > length
    ? `${value.slice(0, length)}\n… [truncated]`
    : value;
}

function inFlight(): Set<string> {
  const state = globalThis as typeof globalThis & {
    __e001McpInFlight?: Set<string>;
  };
  // A process-wide lock prevents two MCP requests from charging one twin at once.
  return (state.__e001McpInFlight ??= new Set());
}

function audit(
  tool: string,
  start: number,
  args: ToolArgs,
  outcome?: string,
  twin?: { id: string; name: string },
): void {
  appendAuditEntry({
    runId: `mcp_${Date.now()}`,
    employeeId: twin?.id ?? "mcp",
    employeeName: twin?.name ?? "MCP client",
    toolName: `mcp__employee001__${tool}`,
    bareName: tool,
    input: args,
    verdict: outcome ? "hard_blocked" : "executed",
    ...(outcome
      ? { blockReason: outcome }
      : { durationMs: Date.now() - start }),
  });
}

function resultError(result: ToolResult): string | undefined {
  if (!result.isError) return undefined;
  try {
    return JSON.parse(result.content[0].text).error;
  } catch {
    return "internal";
  }
}

function profileFiles(
  files: unknown,
): { files: readonly string[] } | { error: ToolResult } {
  const wanted = Array.isArray(files) ? files : PROFILE_FILES;
  const valid = wanted.every(
    (file) =>
      typeof file === "string" &&
      PROFILE_FILES.includes(file as (typeof PROFILE_FILES)[number]),
  );
  return valid
    ? { files: wanted }
    : { error: fail("bad_request", "files must be base profile filenames") };
}

function truncateTranscript(
  turns: Parameters<typeof renderTranscriptForPrompt>[0],
) {
  const remaining = [...turns];
  let turnsOmitted = 0;
  while (
    remaining.length > 1 &&
    Buffer.byteLength(renderTranscriptForPrompt(remaining), "utf8") >
      TRANSCRIPT_LIMIT_BYTES
  ) {
    remaining.shift();
    turnsOmitted++;
  }
  let transcript = renderTranscriptForPrompt(remaining);
  if (Buffer.byteLength(transcript, "utf8") > TRANSCRIPT_LIMIT_BYTES) {
    const marker = "… [truncated]\n";
    const body = Buffer.from(transcript, "utf8")
      .subarray(-(TRANSCRIPT_LIMIT_BYTES - Buffer.byteLength(marker, "utf8")))
      .toString("utf8");
    transcript = `${marker}${body}`;
  }
  return {
    transcript,
    turnsOmitted,
    truncated: turnsOmitted > 0 || transcript.startsWith("… [truncated]"),
  };
}

async function listTwins(): Promise<ToolResult> {
  const employees = await loadEmployeesFromDisk();
  return text(
    employees
      .map((employee) => ({
        id: employee.id,
        name: employee.name,
        firstName: employee.firstName,
        role: employee.role,
        department: employee.department,
        status: employee.twinStatus,
      }))
      .sort((left, right) => left.name.localeCompare(right.name)),
  );
}

async function getTwinProfile(args: ToolArgs): Promise<ToolResult> {
  const employee = (await loadEmployeesFromDisk()).find(
    (candidate) => candidate.id === args.twinId,
  );
  if (!employee) return fail("not_found", "Twin not found");
  const requested = profileFiles(args.files);
  if ("error" in requested) return requested.error;
  const files = Object.fromEntries(
    requested.files.map((file) => [
      file,
      cap(String(readEmployeeFile(employee.id, file)), 16 * 1024),
    ]),
  );
  return text({
    id: employee.id,
    name: employee.name,
    role: employee.role,
    files,
  });
}

async function searchOrganization(args: ToolArgs): Promise<ToolResult> {
  const hits = await searchOrgBrain(String(args.query), {
    source: args.source as string | undefined,
    file: args.file as string | undefined,
    limit: args.limit as number | undefined,
  });
  return text(
    hits.map((hit) => ({
      source: hit.source,
      file: hit.file,
      heading: hit.section,
      snippet: hit.snippet,
      score: hit.score,
    })),
  );
}

async function pendingApprovals(): Promise<ToolResult> {
  return text(
    listPendingApprovals().map((approval) => ({
      id: approval.approvalId,
      employeeId: approval.employeeId,
      toolName: approval.toolName,
      // Raw input may contain messages or credentials, so it is never exposed here.
      summary: cap(
        approval.reason || `${approval.toolName} awaiting approval`,
        200,
      ),
      surface: approval.surface,
      createdAt: approval.createdAt,
    })),
  );
}

async function teamMeetings(): Promise<ToolResult> {
  return text(
    listMeetings()
      .sort((left, right) => right.createdAt - left.createdAt)
      .map((meeting) => ({
        id: meeting.id,
        participantIds: meeting.participantIds,
        turns: meeting.transcript.length,
        createdAt: meeting.createdAt,
        updatedAt: meeting.updatedAt,
      })),
  );
}

async function teamMeeting(args: ToolArgs): Promise<ToolResult> {
  const meeting = getMeeting(String(args.meetingId));
  if (!meeting) return fail("not_found", "Meeting not found");
  const transcript = truncateTranscript(meeting.transcript);
  return text({
    id: meeting.id,
    participantIds: meeting.participantIds,
    transcript: transcript.transcript,
    ...(transcript.truncated
      ? { truncated: true, turnsOmitted: transcript.turnsOmitted }
      : {}),
    sharedFiles: listSharedFiles(meeting.id).map((file) => ({
      name: file.filename,
      summary: file.summary,
      author: file.sharedByName,
    })),
  });
}

async function askTwin(args: ToolArgs): Promise<ToolResult> {
  const employee = (await loadEmployeesFromDisk()).find(
    (candidate) => candidate.id === args.twinId,
  );
  if (!employee) return fail("not_found", "Twin not found");
  if (employee.twinStatus !== "ready")
    return fail("not_ready", "Twin is not ready");
  if (inFlight().has(employee.id))
    return fail("busy", "Twin is already answering an MCP request");
  if (!isUnderBudget(employee.id, 0.5))
    return fail("over_budget", "Twin has insufficient daily budget");
  if (!takeAskTwinRateLimit())
    return fail(
      "rate_limited",
      "ask_twin is limited to 20 calls per rolling hour",
    );

  inFlight().add(employee.id);
  let spent = false;
  try {
    const answer = await runSingleTwin(
      employee,
      [
        "You are being asked a question by a developer's AI assistant through Employee001's MCP server.",
        "No CEO is in the loop.",
        `Answer in your own voice as ${employee.firstName}, grounded in your profile and the org brain.`,
        "Be concise. If you don't know, say so — don't invent decisions.",
        "",
        "Question:",
        String(args.question),
      ].join("\n"),
      (event) => {
        // A runner may emit both terminal events; charge the reported spend once.
        if (
          !spent &&
          (event.type === "employee_done" || event.type === "employee_error") &&
          typeof event.costUsd === "number"
        ) {
          spent = true;
          recordSpend(employee.id, event.costUsd);
        }
      },
      [],
      {
        consultMode: true,
        answerOnly: true,
        maxBudgetUsd: 0.5,
        surface: "chat",
        runId: `mcp_${employee.id}_${Date.now()}`,
      },
    );
    return {
      content: [
        {
          type: "text",
          text: `${employee.firstName} (${employee.role}) says:\n\n${answer}`,
        },
      ],
    };
  } finally {
    inFlight().delete(employee.id);
  }
}

const handlers: Record<ToolName, Handler> = {
  list_twins: listTwins,
  get_twin_profile: getTwinProfile,
  search_org_brain: searchOrganization,
  list_pending_approvals: pendingApprovals,
  list_team_meetings: teamMeetings,
  get_team_meeting: teamMeeting,
  ask_twin: askTwin,
};

export async function executeTool(
  name: string,
  args: ToolArgs,
): Promise<ToolResult> {
  const start = Date.now();
  let twin: { id: string; name: string } | undefined;
  try {
    if (typeof args.twinId === "string")
      twin = (await loadEmployeesFromDisk()).find(
        (candidate) => candidate.id === args.twinId,
      );
    const handler = handlers[name as ToolName];
    const result = handler
      ? await handler(args)
      : fail("bad_request", "Unknown tool");
    audit(name, start, auditArgs(args), resultError(result), twin);
    return result;
  } catch {
    const result = fail("internal", "Internal server error");
    audit(name, start, auditArgs(args), "internal", twin);
    return result;
  }
}

export function auditArgs(args: ToolArgs): ToolArgs {
  const sanitized: ToolArgs = {};
  for (const key of ["twinId", "meetingId", "query", "question"]) {
    if (typeof args[key] === "string")
      sanitized[key] =
        key === "query" || key === "question"
          ? args[key].slice(0, 120)
          : args[key];
  }
  return sanitized;
}
