import "server-only";
import { randomUUID } from "node:crypto";
import { loadEmployeesFromDisk } from "@/lib/employees-disk";
import {
  runCouncil,
  runSingleTwin,
  type CouncilEvent,
} from "@/lib/council-runner";
import { OutputSchemas, type Playbook, type PlaybookOutput } from "./types";
import {
  buildPlaybookContext,
  renderPlaybookPrompt,
  type PlaybookInputs,
  type PlaybookParticipant,
} from "./context";
import { applyPlaybookSinks, type SinkResult } from "./sinks";

export type PlaybookRunResult = {
  runId: string;
  playbookId: string;
  status: "completed" | "completed_with_errors" | "failed" | "budget_exhausted";
  outputs: PlaybookOutput[];
  costUsd: number;
  errors: string[];
  sinks: SinkResult[];
};

export type ReportRunner = (args: {
  playbook: Playbook;
  inputs: PlaybookInputs;
  context: Record<string, unknown>;
}) => unknown | Promise<unknown>;

const reportRunners = new Map<string, ReportRunner>();

export function registerReportRunner(
  playbookId: string,
  runner: ReportRunner,
): () => void {
  reportRunners.set(playbookId, runner);
  return () => reportRunners.delete(playbookId);
}

function parseOutput(playbook: Playbook, text: string): PlaybookOutput {
  const candidate = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const parsed: unknown = JSON.parse(candidate);
  const result = OutputSchemas[playbook.outputSchema].safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join(".") || "output"}: ${issue.message}`)
      .join("; ");
    throw new Error(issues);
  }
  return result.data as PlaybookOutput;
}

function selectParticipants(
  playbook: Playbook,
  employees: Awaited<ReturnType<typeof loadEmployeesFromDisk>>,
) {
  const ready = employees.filter((employee) => employee.twinStatus === "ready");
  const scope = playbook.participants;
  if (scope === "all") return ready;
  if (Array.isArray(scope))
    return ready.filter((employee) => scope.includes(employee.id));
  return ready.filter(
    (employee) =>
      (!scope.role || employee.role === scope.role) &&
      (!scope.department || employee.department === scope.department),
  );
}

function outputInstruction(error: string): string {
  return `\n\nYour previous reply failed validation: ${error}. Reply once more with ONLY corrected JSON.`;
}

function facilitatorPrompt(
  prompt: string,
  transcript: string,
  playbook: Playbook,
): string {
  return (
    `${prompt}\n\n<team_meeting_transcript>\n${transcript}\n</team_meeting_transcript>\n\n` +
    `Synthesize the Team Meeting. Return ONLY JSON matching the ${playbook.outputSchema} schema.`
  );
}

function asParticipants(
  employees: Awaited<ReturnType<typeof loadEmployeesFromDisk>>,
): PlaybookParticipant[] {
  return employees.map((employee) => ({
    id: employee.id,
    name: employee.name,
  }));
}

export async function runPlaybook(
  playbook: Playbook,
  inputs: PlaybookInputs,
): Promise<PlaybookRunResult> {
  const runId = `playbook_${randomUUID()}`;
  const employees = await loadEmployeesFromDisk();
  const participants = selectParticipants(playbook, employees);
  const participantContext = asParticipants(participants);
  const context = buildPlaybookContext(playbook, inputs, participantContext);
  const prompt = renderPlaybookPrompt(playbook, inputs, context);
  const outputs: PlaybookOutput[] = [];
  const errors: string[] = [];
  let costUsd = 0;
  let exhausted = false;

  if (playbook.schedule) {
    // TODO(E-125b): schedule this through the routines scheduler.
  }

  const runStructuredTwin = async (
    employee: (typeof participants)[number],
    question: string,
  ) => {
    let observedCost = 0;
    const onEvent = (event: CouncilEvent) => {
      if (event.type === "employee_done") observedCost += event.costUsd;
      if (event.type === "employee_error" && event.costUsd)
        observedCost += event.costUsd;
    };
    const run = async (questionToRun: string) => {
      // Each call has its own observer so retry cost is never re-counted.
      observedCost = 0;
      const reply = await runSingleTwin(employee, questionToRun, onEvent, [], {
        runId,
        surface: "background",
        maxBudgetUsd: Math.max(0, playbook.budgetUsd - costUsd),
        answerOnly: true,
      });
      costUsd += observedCost;
      return reply;
    };

    const reply = await run(question);
    try {
      return parseOutput(playbook, reply);
    } catch (firstError) {
      const message =
        firstError instanceof Error ? firstError.message : "invalid output";
      if (costUsd >= playbook.budgetUsd) {
        exhausted = true;
        errors.push(`${employee.id}: ${message}`);
        return undefined;
      }
      const retry = await run(question + outputInstruction(message));
      try {
        return parseOutput(playbook, retry);
      } catch (secondError) {
        const retryMessage =
          secondError instanceof Error ? secondError.message : "invalid output";
        errors.push(`${employee.id}: ${retryMessage}`);
        return undefined;
      }
    }
  };

  if (playbook.mode === "report") {
    const runner = reportRunners.get(playbook.id);
    if (!runner) errors.push("no report runner registered");
    else {
      try {
        outputs.push(
          parseOutput(
            playbook,
            JSON.stringify(await runner({ playbook, inputs, context })),
          ),
        );
      } catch (error) {
        errors.push(error instanceof Error ? error.message : "report failed");
      }
    }
  } else if (!participants.length) {
    errors.push("no ready participants found");
  } else if (playbook.mode === "single") {
    const output = await runStructuredTwin(participants[0], prompt);
    if (output) outputs.push(output);
  } else if (costUsd < playbook.budgetUsd) {
    const texts = new Map<string, string>();
    const onEvent = (event: CouncilEvent) => {
      if (event.type === "employee_done") costUsd += event.costUsd;
      if (event.type === "employee_error" && event.costUsd)
        costUsd += event.costUsd;
      if (event.type === "employee_error") {
        errors.push(`${event.employeeId}: ${event.message}`);
      }
      if (event.type === "text_delta") {
        texts.set(
          event.employeeId,
          (texts.get(event.employeeId) ?? "") + event.delta,
        );
      }
    };
    await runCouncil({
      responders: participants,
      question: prompt,
      allParticipants: employees.filter(
        (employee) => employee.twinStatus === "ready",
      ),
      onEvent,
    });
    if (costUsd >= playbook.budgetUsd) exhausted = true;
    else {
      const facilitator =
        participants.find(
          (employee) => employee.id === playbook.facilitatorId,
        ) ?? participants[0];
      const transcript = participants
        .map(
          (participant) =>
            `${participant.name}: ${texts.get(participant.id) ?? ""}`,
        )
        .join("\n\n");
      const output = await runStructuredTwin(
        facilitator,
        facilitatorPrompt(prompt, transcript, playbook),
      );
      if (output) outputs.push(output);
    }
  } else {
    exhausted = true;
  }

  const sinks: SinkResult[] = [];
  for (const output of outputs) {
    sinks.push(
      ...(await applyPlaybookSinks(
        playbook,
        output,
        runId,
        inputs,
        participantContext,
      )),
    );
  }
  const status = exhausted
    ? "budget_exhausted"
    : errors.length && outputs.length
      ? "completed_with_errors"
      : errors.length
        ? "failed"
        : "completed";
  return {
    runId,
    playbookId: playbook.id,
    status,
    outputs,
    costUsd,
    errors,
    sinks,
  };
}
