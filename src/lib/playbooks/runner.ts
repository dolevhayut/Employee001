import "server-only";
import { randomUUID } from "node:crypto";
import { loadEmployeesFromDisk } from "@/lib/employees-disk";
import { runSingleTwin, type CouncilEvent } from "@/lib/council-runner";
import { OutputSchemas, type Playbook, type PlaybookOutput } from "./types";
import { buildPlaybookContext, renderPlaybookPrompt, type PlaybookInputs } from "./context";
import { applyPlaybookSinks, type SinkResult } from "./sinks";

export type PlaybookRunResult = {
  runId: string; playbookId: string; status: "completed" | "failed" | "budget_exhausted";
  outputs: PlaybookOutput[]; costUsd: number; errors: string[]; sinks: SinkResult[];
};
export type ReportRunner = (args: { playbook: Playbook; inputs: PlaybookInputs; context: Record<string, unknown> }) => unknown | Promise<unknown>;
const reportRunners = new Map<string, ReportRunner>();
export function registerReportRunner(playbookId: string, runner: ReportRunner): () => void { reportRunners.set(playbookId, runner); return () => reportRunners.delete(playbookId); }

function parseOutput(playbook: Playbook, text: string): PlaybookOutput {
  const candidate = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const parsed: unknown = JSON.parse(candidate);
  const result = OutputSchemas[playbook.outputSchema].safeParse(parsed);
  if (!result.success) throw new Error(result.error.issues.map((issue) => `${issue.path.join(".") || "output"}: ${issue.message}`).join("; "));
  return result.data as PlaybookOutput;
}
function selectParticipants(playbook: Playbook, employees: Awaited<ReturnType<typeof loadEmployeesFromDisk>>) {
  const ready = employees.filter((employee) => employee.twinStatus === "ready");
  const scope = playbook.participants;
  if (scope === "all") return ready;
  if (Array.isArray(scope)) return ready.filter((employee) => scope.includes(employee.id));
  return ready.filter((employee) => (!scope.role || employee.role === scope.role) && (!scope.department || employee.department === scope.department));
}
function outputInstruction(error: string) { return `\n\nYour previous reply failed validation: ${error}. Reply once more with ONLY corrected JSON.`; }

export async function runPlaybook(playbook: Playbook, inputs: PlaybookInputs): Promise<PlaybookRunResult> {
  const runId = `playbook_${randomUUID()}`;
  const context = buildPlaybookContext(playbook, inputs);
  const prompt = renderPlaybookPrompt(playbook, inputs, context);
  const outputs: PlaybookOutput[] = []; const errors: string[] = []; let costUsd = 0;
  if (playbook.schedule) { /* TODO(E-125b): schedule this through the routines scheduler. */ }
  if (playbook.mode === "report") {
    const runner = reportRunners.get(playbook.id);
    if (!runner) return { runId, playbookId: playbook.id, status: "failed", outputs, costUsd, errors: ["no report runner registered"], sinks: [] };
    try { outputs.push(parseOutput(playbook, JSON.stringify(await runner({ playbook, inputs, context })))); }
    catch (error) { errors.push(error instanceof Error ? error.message : "report failed"); }
  } else {
    const participants = selectParticipants(playbook, await loadEmployeesFromDisk());
    if (!participants.length) errors.push("no ready participants found");
    const toRun = playbook.mode === "single" ? participants.slice(0, 1) : participants;
    for (const employee of toRun) {
      const remaining = playbook.budgetUsd - costUsd;
      if (remaining <= 0) return { runId, playbookId: playbook.id, status: "budget_exhausted", outputs, costUsd, errors, sinks: outputs.flatMap((output) => applyPlaybookSinks(playbook, output, runId)) };
      let observedCost = 0;
      const onEvent = (event: CouncilEvent) => { if (event.type === "employee_done") observedCost = event.costUsd; if (event.type === "employee_error" && event.costUsd) observedCost = event.costUsd; };
      let reply = await runSingleTwin(employee, prompt, onEvent, [], { runId, surface: "background", maxBudgetUsd: remaining, answerOnly: true });
      costUsd += observedCost;
      try { outputs.push(parseOutput(playbook, reply)); }
      catch (firstError) {
        const message = firstError instanceof Error ? firstError.message : "invalid output";
        reply = await runSingleTwin(employee, prompt + outputInstruction(message), onEvent, [], { runId, surface: "background", maxBudgetUsd: Math.max(0, playbook.budgetUsd - costUsd), answerOnly: true });
        costUsd += observedCost;
        try { outputs.push(parseOutput(playbook, reply)); } catch (secondError) { errors.push(`${employee.id}: ${secondError instanceof Error ? secondError.message : "invalid output"}`); }
      }
    }
  }
  const status = errors.length ? "failed" : "completed";
  const sinks = status === "completed" ? outputs.flatMap((output) => applyPlaybookSinks(playbook, output, runId)) : [];
  return { runId, playbookId: playbook.id, status, outputs, costUsd, errors, sinks };
}
