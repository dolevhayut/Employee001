import { afterEach, describe, expect, it, vi } from "vitest";

const relay = vi.hoisted(() => ({ turn: vi.fn() }));
vi.mock("./relay/model", () => ({ relayTurn: relay.turn }));

import { interviewTranscript, nextInterviewQuestion, SELF_INTERVIEW_MAX_QUESTIONS } from "./self-interview";

afterEach(() => relay.turn.mockReset());

const turn = (n: number) => ({ question: `Q${n}?`, answer: `A${n}.` });

describe("Interview me", () => {
  it("asks the next question from the exchange so far", async () => {
    relay.turn.mockResolvedValue("What decisions do you make most often?\n");
    const q = await nextInterviewQuestion({ name: "Maya", role: "Head of CS", turns: [turn(1)] });
    expect(q).toBe("What decisions do you make most often?");
    const prompt = relay.turn.mock.calls[0][0].prompt as string;
    expect(prompt).toContain("Questions asked so far: 1");
    expect(prompt).toContain("**A:** A1.");
  });

  it("ends on DONE or after the last question, without asking the model again", async () => {
    relay.turn.mockResolvedValue("DONE");
    expect(await nextInterviewQuestion({ name: "Maya", role: "CS", turns: [turn(1)] })).toBeNull();
    relay.turn.mockClear();
    const full = Array.from({ length: SELF_INTERVIEW_MAX_QUESTIONS }, (_, i) => turn(i));
    expect(await nextInterviewQuestion({ name: "Maya", role: "CS", turns: full })).toBeNull();
    expect(relay.turn).not.toHaveBeenCalled();
  });

  it("writes the transcript the builder reads", () => {
    expect(interviewTranscript([turn(1), turn(2)])).toBe("**Q:** Q1?\n\n**A:** A1.\n\n**Q:** Q2?\n\n**A:** A2.");
  });
});
