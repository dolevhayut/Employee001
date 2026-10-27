import { describe, expect, it, vi } from "vitest";
import type { EmployeeWithTwin } from "@/lib/employees";

const meeting: { id: string; transcript: unknown[]; sharedFiles: unknown[]; brief?: unknown } = { id: "meeting-retired", transcript: [], sharedFiles: [] };

vi.mock("@/lib/model-provider", () => ({
  canRunModel: () => ({ ok: true }),
}));
vi.mock("@/lib/meeting-store", () => ({
  getOrCreateMeeting: vi.fn(() => meeting),
  appendTurn: vi.fn(),
  listSharedFiles: vi.fn(() => []),
  renderSharedFilesForPrompt: vi.fn(() => ""),
  renderTranscriptForPrompt: vi.fn(() => ""),
  setMeetingBrief: vi.fn(() => true),
  setMeetingForget: vi.fn(),
}));
vi.mock("@/lib/meeting-memory", () => ({
  buildMeetingBrief: vi.fn(async () => ({ text: "Decided: X", builtAt: 1, sources: { meetings: ["m1"], routines: [], people: [] } })),
  maybeDigestMeeting: vi.fn(async () => {}),
  auditMeetingBrief: vi.fn(),
  renderBriefForPrompt: () => "",
}));
vi.mock("@/lib/knowledge-proposals", () => ({
  proposalsEnabled: () => false,
  proposeKnowledgeFromMeeting: vi.fn(),
}));

import { runCouncil } from "./council-runner";
import { setMeetingBrief, setMeetingForget } from "@/lib/meeting-store";
import { auditMeetingBrief, buildMeetingBrief, maybeDigestMeeting } from "@/lib/meeting-memory";

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

  describe("meeting memory", () => {
    const retired = { id: "former-ops", name: "Former Ops", firstName: "Former", lifecycle: "retired" } as EmployeeWithTwin;
    const run = (extra: { fresh?: boolean; forget?: boolean } = {}) =>
      runCouncil({ responders: [retired], allParticipants: [retired], question: "q", onEvent: () => {}, ...extra });

    it("freezes a brief on a new meeting, audits it, and digests after the round", async () => {
      vi.clearAllMocks();
      meeting.transcript = [];
      await run();
      expect(buildMeetingBrief).toHaveBeenCalledWith({ participantIds: undefined, excludeMeetingId: "meeting-retired" });
      expect(setMeetingBrief).toHaveBeenCalledTimes(1);
      expect(auditMeetingBrief).toHaveBeenCalledTimes(1);
      expect(maybeDigestMeeting).toHaveBeenCalledWith("meeting-retired");
    });

    it("skips the brief on Start fresh and records Don't remember", async () => {
      vi.clearAllMocks();
      meeting.transcript = [];
      await run({ fresh: true, forget: true });
      expect(buildMeetingBrief).not.toHaveBeenCalled();
      expect(setMeetingForget).toHaveBeenCalledWith("meeting-retired", true);
    });

    it("never rebuilds the brief or changes memory once the meeting has turns", async () => {
      vi.clearAllMocks();
      meeting.transcript = [{ kind: "ceo", text: "earlier", ts: 1 }];
      await run({ forget: true });
      expect(buildMeetingBrief).not.toHaveBeenCalled();
      expect(setMeetingForget).not.toHaveBeenCalled();
      meeting.transcript = [];
    });

    it("still runs the meeting when building the brief fails", async () => {
      vi.clearAllMocks();
      meeting.transcript = [];
      vi.mocked(buildMeetingBrief).mockRejectedValueOnce(new Error("disk"));
      const events: string[] = [];
      await runCouncil({ responders: [retired], allParticipants: [retired], question: "q", onEvent: (e) => events.push(e.type) });
      expect(events).toEqual(["council_done"]);
      expect(setMeetingBrief).not.toHaveBeenCalled();
    });
  });
});
