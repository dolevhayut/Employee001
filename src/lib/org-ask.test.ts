import { afterEach, describe, expect, it, vi } from "vitest";

const relay = vi.hoisted(() => ({ turn: vi.fn() }));
vi.mock("@/lib/relay/model", () => ({ relayTurn: relay.turn }));
vi.mock("@/lib/council-runner", () => ({ runSingleTwin: vi.fn() }));

import { synthesize } from "./org-ask";

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
  relay.turn.mockReset();
});

const brief = { id: "dana", name: "Dana", title: "CFO", brief: "- Q3 budget is $1.2M" };

async function collect(question: string, sources: Parameters<typeof synthesize>[1], failure: string | null) {
  let out = "";
  await synthesize(question, sources, (d) => { out += d; }, failure);
  return out;
}

describe("synthesize", () => {
  it("says why when no source could run, instead of 'no one knew'", async () => {
    expect(await collect("What's the Q3 budget?", [null], "Run `claude` in a terminal and sign in.")).toBe("Couldn't reach the twins: Run `claude` in a terminal and sign in.");
    expect(await collect("What's the Q3 budget?", [null], null)).toBe("No one on the team had anything on this.");
  });

  it("writes the answer on the configured provider when there's no direct API", async () => {
    process.env.EMPLOYEE001_MODEL_PROVIDER = "claude-code";
    relay.turn.mockImplementation(async (args: { onDelta: (d: string) => void }) => { args.onDelta("We budgeted $1.2M [[dana]]."); return ""; });
    expect(await collect("What's the Q3 budget?", [brief], null)).toBe("We budgeted $1.2M [[dana]].");
    expect(relay.turn).toHaveBeenCalledOnce();
  });

  it("falls back to the briefs when that run fails before writing", async () => {
    process.env.EMPLOYEE001_MODEL_PROVIDER = "bedrock";
    relay.turn.mockRejectedValue(new Error("boom"));
    expect(await collect("What's the Q3 budget?", [brief], null)).toBe("- Q3 budget is $1.2M [[dana]]");
  });
});
