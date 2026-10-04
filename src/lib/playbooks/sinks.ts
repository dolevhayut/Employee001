import "server-only";
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "@/lib/app-home";
import { appendFeedItem } from "@/lib/feed-store";
import { registerApproval } from "@/lib/approval-bus";
import type { Playbook, PlaybookOutput } from "./types";

export type SinkResult = { sink: string; approvalId?: string; path?: string };
export function applyPlaybookSinks(playbook: Playbook, output: PlaybookOutput, runId: string): SinkResult[] {
  const detail = JSON.stringify(output);
  return playbook.sinks.map((sink) => {
    if (sink === "feed") { appendFeedItem({ source: { kind: "shift", employeeId: "playbook", runId }, type: "update", title: playbook.name, detail }); return { sink }; }
    if (sink === "scratch_doc") { const target = dataDir("scratch", "playbooks", `${runId}.json`); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, detail + "\n", "utf8"); return { sink, path: target }; }
    // Mutating destinations are intentionally requests, never direct writes.
    const approval = registerApproval({ runId, employeeId: "playbook", employeeName: "Playbook engine", toolName: `playbook_${sink}`, bareName: sink, input: { playbookId: playbook.id, output }, reason: `${playbook.name} proposes a ${sink.replace(/_/g, " ")}`, surface: "background" });
    return { sink, approvalId: approval.approvalId };
  });
}
