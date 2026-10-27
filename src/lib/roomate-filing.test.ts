import { describe, expect, it } from "vitest";
import { buildFilingPrompt, extractTaskId, meetingPeople, resolveActionOwner, roomateAvailable } from "./roomate-filing";

describe("roomateAvailable", () => {
  const server = (name: string, enabled = true, url = "https://mcp.roomate.example/mcp") => ({ name, enabled, url });

  it("finds an enabled server named Roomate in any case", () => {
    expect(roomateAvailable([server("Roomate")])).toBe(true);
    expect(roomateAvailable([server("supabase"), server("  ROOMATE ")])).toBe(true);
  });

  it("ignores disabled, url-less and differently named servers", () => {
    expect(roomateAvailable([])).toBe(false);
    expect(roomateAvailable([server("Roomate", false)])).toBe(false);
    expect(roomateAvailable([server("Roomate", true, "")])).toBe(false);
    expect(roomateAvailable([server("Roomate dev"), server("roommate")])).toBe(false);
  });
});

describe("meetingPeople + resolveActionOwner", () => {
  const people = meetingPeople(
    [
      { id: "emp_noa", name: "Noa" },
      { id: "emp_itai", name: "Itai Levi" },
    ],
    [
      { kind: "ceo" },
      { kind: "twin", employeeId: "emp_noa", employeeName: "Noa" },
      { kind: "twin", employeeId: "emp_dana", employeeName: "Dana" },
      { kind: "twin", employeeId: "[deleted]", employeeName: "[deleted]" },
    ],
  );

  it("includes twins who spoke without being in the room, once each", () => {
    expect(people.map((p) => p.id)).toEqual(["emp_noa", "emp_itai", "emp_dana"]);
  });

  it("resolves by id first, then by name or first name, case-insensitively", () => {
    expect(resolveActionOwner("emp_itai", people)).toBe("emp_itai");
    expect(resolveActionOwner("noa", people)).toBe("emp_noa");
    expect(resolveActionOwner("@Dana", people)).toBe("emp_dana");
    expect(resolveActionOwner("itai", people)).toBe("emp_itai");
    expect(resolveActionOwner("Itai Levi", people)).toBe("emp_itai");
  });

  it("returns null when nobody in the meeting matches", () => {
    expect(resolveActionOwner(undefined, people)).toBeNull();
    expect(resolveActionOwner("  ", people)).toBeNull();
    expect(resolveActionOwner("emp_shira", people)).toBeNull();
    expect(resolveActionOwner("Shira", people)).toBeNull();
  });
});

describe("extractTaskId", () => {
  it("takes the id from the closing 'Roomate task:' line only", () => {
    expect(extractTaskId("Filed it.\nRoomate task: tsk_9fk2m1x0")).toBe("tsk_9fk2m1x0");
    expect(extractTaskId("Roomate task: `tsk_abc123`")).toBe("tsk_abc123");
    expect(extractTaskId("**Roomate task:** tsk_AbC123def")).toBe("tsk_AbC123def");
  });

  it("ignores related or duplicate ids mentioned elsewhere (the #1216 case)", () => {
    const reply = "I filed #1216. Nothing public merges until the attack run in tsk_hv8dyqhfmh passes.\nRoomate task: tsk_new1216x";
    expect(extractTaskId(reply)).toBe("tsk_new1216x");
    expect(extractTaskId("Related to tsk_hv8dyqhfmh, see there.")).toBeNull();
  });

  it("returns null without a filed line", () => {
    expect(extractTaskId("The approval was declined.\nRoomate task: none")).toBeNull();
    expect(extractTaskId("I called list_tasks and create_tasks.")).toBeNull();
    expect(extractTaskId("Roomate task: tsk_")).toBeNull();
    expect(extractTaskId("")).toBeNull();
    expect(extractTaskId(undefined)).toBeNull();
  });

  it("does not match inside a longer identifier", () => {
    expect(extractTaskId("Roomate task: tsk_abc123_more")).toBeNull();
  });
});

describe("buildFilingPrompt", () => {
  it("names the meeting, the skill, the action and the decision", () => {
    const prompt = buildFilingPrompt({
      meetingId: "mtg_1_abc",
      title: "Why is checkout\nfailing?",
      action: "Fix the coupon rounding bug.",
      decision: "Fix checkout before the launch.",
    });
    expect(prompt).toContain("From Team Meeting 'Why is checkout failing?' (mtg_1_abc)");
    expect(prompt).toContain("following your 'Filing work to the dev team (Roomate)' skill: Fix the coupon rounding bug.");
    expect(prompt).toContain("Context: Fix checkout before the launch.");
    expect(prompt).toContain("tsk_");
  });

  it("falls back to a title and skips an empty decision", () => {
    const prompt = buildFilingPrompt({ meetingId: "mtg_2", title: "", action: "Add a test" });
    expect(prompt).toContain("Team Meeting 'Untitled meeting' (mtg_2)");
    expect(prompt).not.toContain("Context:");
  });
});
