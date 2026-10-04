import { readEmployeeFile } from "@/lib/employees-files";
import { loadEmployeesFromDisk } from "@/lib/employees-disk";
import { searchOrgBrain } from "@/lib/org-brain-search";
import { listPendingApprovals } from "@/lib/approval-bus";
import { getMeeting, listMeetings, listSharedFiles, renderTranscriptForPrompt } from "@/lib/meeting-store";
import { runSingleTwin } from "@/lib/council-runner";
import { isUnderBudget, recordSpend } from "@/lib/twin-budget";
import { appendAuditEntry } from "@/lib/audit-log";
import { takeAskTwinRateLimit } from "./rate-limit";

export const PROFILE_FILES = ["EXPERTISE.md", "TONE.md", "CONTEXT.md", "DECISIONS.md", "PREFERENCES.md", "PEOPLE.md", "PROJECTS.md", "BOUNDARIES.md", "EMPLOYMENT.md"] as const;
type ToolResult = { content: [{ type: "text"; text: string }]; isError?: boolean };
const text = (value: unknown): ToolResult => ({ content: [{ type: "text", text: JSON.stringify(value, null, 2) }] });
const fail = (error: string, message: string): ToolResult => ({ content: [{ type: "text", text: JSON.stringify({ error, message }) }], isError: true });
const cap = (value: string, n: number) => value.length > n ? `${value.slice(0, n)}\n… [truncated]` : value;
const preview = (value: string) => value.slice(0, 120);
const inFlight = (): Set<string> => ((globalThis as typeof globalThis & { __e001McpInFlight?: Set<string> }).__e001McpInFlight ??= new Set());

function audit(tool: string, start: number, args: Record<string, unknown>, outcome?: string, twin?: { id: string; name: string }) {
  appendAuditEntry({ runId: `mcp_${Date.now()}`, employeeId: twin?.id ?? "mcp", employeeName: twin?.name ?? "MCP client", toolName: `mcp__employee001__${tool}`, bareName: tool, input: args, verdict: outcome ? "hard_blocked" : "executed", ...(outcome ? { blockReason: outcome } : { durationMs: Date.now() - start }) });
}

export async function executeTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  const start = Date.now(); let twin: { id: string; name: string } | undefined;
  const done = (result: ToolResult) => { audit(name, start, auditArgs(args), result.isError ? JSON.parse(result.content[0].text).error : undefined, twin); return result; };
  try {
    const employees = await loadEmployeesFromDisk();
    if (name === "list_twins") return done(text(employees.map((e) => ({ id: e.id, name: e.name, firstName: e.firstName, role: e.role, department: e.department, status: e.twinStatus })).sort((a,b) => a.name.localeCompare(b.name))));
    if (name === "get_twin_profile") {
      const employee = employees.find((e) => e.id === args.twinId); if (!employee) return done(fail("not_found", "Twin not found")); twin = employee;
      const wanted = Array.isArray(args.files) ? args.files : PROFILE_FILES;
      if (wanted.some((f) => typeof f !== "string" || !PROFILE_FILES.includes(f as typeof PROFILE_FILES[number]))) return done(fail("bad_request", "files must be base profile filenames"));
      const all = Object.fromEntries(wanted.map((f) => [f, readEmployeeFile(employee.id, f as string)]));
      return done(text({ id: employee.id, name: employee.name, role: employee.role, files: Object.fromEntries(Object.entries(all).map(([f, body]) => [f, cap(String(body), 16 * 1024)])) }));
    }
    if (name === "search_org_brain") return done(text((await searchOrgBrain(String(args.query), { source: args.source as string | undefined, file: args.file as string | undefined, limit: args.limit as number | undefined })).map((h) => ({ source: h.source, file: h.file, heading: h.section, snippet: h.snippet, score: h.score }))));
    if (name === "list_pending_approvals") return done(text(listPendingApprovals().map((a) => ({ id: a.approvalId, employeeId: a.employeeId, toolName: a.toolName, summary: cap(a.reason || JSON.stringify(a.input), 200), surface: a.surface, createdAt: a.createdAt }))));
    if (name === "list_team_meetings") return done(text(listMeetings().sort((a,b) => b.createdAt-a.createdAt).map((m) => ({ id: m.id, participantIds: m.participantIds, turns: m.transcript.length, createdAt: m.createdAt, updatedAt: m.updatedAt }))));
    if (name === "get_team_meeting") { const m = getMeeting(String(args.meetingId)); if (!m) return done(fail("not_found", "Meeting not found")); const rendered = renderTranscriptForPrompt(m.transcript); const omitted = rendered.length > 64 * 1024 ? rendered.length - (64 * 1024) : 0; return done(text({ id: m.id, participantIds: m.participantIds, transcript: omitted ? `… [truncated]\n${rendered.slice(-64 * 1024)}` : rendered, ...(omitted ? { truncated: true, turnsOmitted: 1 } : {}), sharedFiles: listSharedFiles(m.id).map((f) => ({ name: f.filename, summary: f.summary, author: f.sharedByName })) })); }
    if (name === "ask_twin") {
      const employee = employees.find((e) => e.id === args.twinId); if (!employee) return done(fail("not_found", "Twin not found")); twin = employee;
      if (employee.twinStatus !== "ready") return done(fail("not_ready", "Twin is not ready"));
      if (inFlight().has(employee.id)) return done(fail("busy", "Twin is already answering an MCP request"));
      if (!isUnderBudget(employee.id, .5)) return done(fail("over_budget", "Twin has insufficient daily budget"));
      if (!takeAskTwinRateLimit()) return done(fail("rate_limited", "ask_twin is limited to 20 calls per rolling hour"));
      inFlight().add(employee.id); let spent = false;
      try { const question = String(args.question); const answer = await runSingleTwin(employee, `You are being asked a question by a developer's AI assistant through Employee001's MCP server. No CEO is in the loop. Answer in your own voice as ${employee.firstName}, grounded in your profile and the org brain. Be concise. If you don't know, say so — don't invent decisions.\n\nQuestion:\n${question}`, (event) => { if ((event.type === "employee_done" || event.type === "employee_error") && event.costUsd && !spent) { spent = true; recordSpend(employee.id, event.costUsd); } }, [], { consultMode: true, answerOnly: true, maxBudgetUsd: .5, surface: "chat", runId: `mcp_${employee.id}_${Date.now()}` }); return done({ content: [{ type: "text", text: `${employee.firstName} (${employee.role}) says:\n\n${answer}` }] }); } finally { inFlight().delete(employee.id); }
    }
    return done(fail("bad_request", "Unknown tool"));
  } catch { return done(fail("internal", "Internal server error")); }
}

export function auditArgs(args: Record<string, unknown>): Record<string, unknown> { const out: Record<string, unknown> = {}; for (const k of ["twinId", "meetingId", "query", "question"]) if (typeof args[k] === "string") out[k] = k === "query" || k === "question" ? preview(args[k] as string) : args[k]; return out; }
