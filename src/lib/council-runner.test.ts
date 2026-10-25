import { describe, expect, it, vi } from "vitest";
import type { EmployeeWithTwin } from "@/lib/employees";

const meeting = { id: "meeting-retired", transcript: [], sharedFiles: [] };

vi.mock("@/lib/model-provider", () => ({
  canRunModel: () => ({ ok: true }),
}));
vi.mock("@/lib/meeting-store", () => ({
  getOrCreateMeeting: vi.fn(() => meeting),
  appendTurn: vi.fn(),
  listSharedFiles: vi.fn(() => []),
  renderSharedFilesForPrompt: vi.fn(() => ""),
  renderTranscriptForPrompt: vi.fn(() => ""),
}));
vi.mock("@/lib/knowledge-proposals", () => ({
  proposalsEnabled: () => false,
  proposeKnowledgeFromMeeting: vi.fn(),
}));

import { runCouncil } from "./council-runner";

describe("runCouncil", () => {
  it("does not run a retired twin passed outside the meeting picker", async () => {
    const retired = {
      id: "former-ops",
      name: "Former Ops",
      firstName: "Former",
      lifecycle: "retired",
    } as EmployeeWithTwin;
    const events: string[] = [];

    await runCouncil({
      responders: [retired],
      allParticipants: [retired],
      question: "What changed?",
      onEvent: (event) => events.push(event.type),
    });

    expect(events).toEqual(["council_done"]);
  });
});
