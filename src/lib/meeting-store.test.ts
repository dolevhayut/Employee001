import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Store = typeof import("./meeting-store");

let home: string;
const meetingsDir = () => path.join(home, "data", "meetings");
const onDisk = (id: string) => JSON.parse(fs.readFileSync(path.join(meetingsDir(), id, "meeting.json"), "utf8"));

/** A fresh module instance = an empty in-memory map, i.e. a server restart. */
async function boot(): Promise<Store> {
  vi.resetModules();
  return import("./meeting-store");
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "employee001-meetings-"));
  process.env.EMPLOYEE001_HOME = home;
});

afterEach(() => {
  delete process.env.EMPLOYEE001_HOME;
  fs.rmSync(home, { recursive: true, force: true });
  vi.useRealTimers();
});

describe("meeting persistence", () => {
  it("survives a restart and can be continued", async () => {
    let store = await boot();
    const m = store.createMeeting(["noa", "itai"]);
    store.appendTurn(m.id, { kind: "ceo", text: "  Should we   raise prices\nin Q3? ", ts: 1 });
    store.appendTurn(m.id, { kind: "twin", employeeId: "noa", employeeName: "Noa", text: "Yes, by 5%.", ts: 2 });
    store.recordSharedFile(m.id, { filename: "plan.md", content: "# plan", summary: "pricing plan", sharedById: "noa", sharedByName: "Noa" });

    store = await boot();
    const back = store.getMeeting(m.id)!;
    expect(back.title).toBe("Should we raise prices in Q3?");
    expect(back.participantIds).toEqual(["noa", "itai"]);
    expect(back.transcript.map((t) => t.text)).toEqual(["  Should we   raise prices\nin Q3? ", "Yes, by 5%."]);
    expect(store.readSharedFile(m.id, "plan.md")).toMatchObject({ status: "text", content: "# plan" });

    // Continuing returns the same meeting, not a new one, and keeps writing.
    const again = store.getOrCreateMeeting(m.id, ["someone-else"]);
    expect(again).toBe(back);
    store.appendTurn(m.id, { kind: "ceo", text: "And Q4?", ts: 3 });
    expect(onDisk(m.id).transcript).toHaveLength(3);
    expect(onDisk(m.id).title).toBe("Should we raise prices in Q3?");
  });

  it("trims long titles to 80 characters", async () => {
    const store = await boot();
    const m = store.createMeeting(["noa"]);
    store.appendTurn(m.id, { kind: "ceo", text: "word ".repeat(40), ts: 1 });
    expect(store.getMeeting(m.id)!.title.length).toBeLessThanOrEqual(80);
    expect(store.getMeeting(m.id)!.title.endsWith("…")).toBe(true);
  });

  it("writes atomically: a tmp file renamed over meeting.json, none left behind", async () => {
    const store = await boot();
    const writes: string[] = [];
    const renames: [string, string][] = [];
    const realWrite = fs.writeFileSync.bind(fs);
    const realRename = fs.renameSync.bind(fs);
    const w = vi.spyOn(fs, "writeFileSync").mockImplementation((file, data, opts) => {
      writes.push(String(file));
      realWrite(file, data, opts);
    });
    const r = vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      renames.push([String(from), String(to)]);
      realRename(from, to);
    });
    const m = store.createMeeting(["noa"]);
    w.mockRestore();
    r.mockRestore();

    const target = path.join(meetingsDir(), m.id, "meeting.json");
    expect(writes).toHaveLength(1);
    expect(writes[0]).not.toBe(target);
    expect(writes[0].endsWith(".tmp")).toBe(true);
    expect(renames).toEqual([[writes[0], target]]);
    expect(fs.readdirSync(path.join(meetingsDir(), m.id))).toEqual(["meeting.json"]);
  });

  it("keeps the old record when a write fails midway", async () => {
    const store = await boot();
    const m = store.createMeeting(["noa"]);
    store.appendTurn(m.id, { kind: "ceo", text: "first", ts: 1 });
    const r = vi.spyOn(fs, "renameSync").mockImplementation(() => {
      throw new Error("disk full");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    store.appendTurn(m.id, { kind: "ceo", text: "second", ts: 2 });
    r.mockRestore();
    warn.mockRestore();
    expect(onDisk(m.id).transcript).toHaveLength(1);
    expect(fs.readdirSync(path.join(meetingsDir(), m.id))).toEqual(["meeting.json"]);
  });

  it("rejects ids that are not meeting ids before touching the disk", async () => {
    const store = await boot();
    fs.mkdirSync(path.join(home, "data", "secret"), { recursive: true });
    fs.writeFileSync(path.join(home, "data", "secret", "meeting.json"), JSON.stringify({ id: "../secret", transcript: [] }));
    for (const bad of ["../secret", "mtg_../../x", "mtg_a/b", "", "mtg_", "x".repeat(10)]) {
      expect(store.isValidMeetingId(bad)).toBe(false);
      expect(store.getMeeting(bad)).toBeUndefined();
      expect(store.deleteMeeting(bad)).toBe(false);
      expect(store.readSharedFileBytes(bad, "meeting.json")).toEqual({ found: false });
    }
    expect(fs.existsSync(path.join(home, "data", "secret", "meeting.json"))).toBe(true);
    // An unknown id starts a new meeting instead of resolving a path.
    const fresh = store.getOrCreateMeeting("../secret", ["noa"]);
    expect(store.isValidMeetingId(fresh.id)).toBe(true);
  });

  it("stores a summary on the meeting", async () => {
    let store = await boot();
    const m = store.createMeeting(["noa"]);
    store.appendTurn(m.id, { kind: "ceo", text: "Raise prices?", ts: 1 });
    store.appendTurn(m.id, { kind: "twin", employeeId: "noa", employeeName: "Noa", text: "Yes.", ts: 2 });
    const saved = store.setMeetingSummary(m.id, { decision: "Raise by 5%", actions: [{ employeeId: "noa", action: "Update the price page" }], open: ["Annual plans?"] });
    expect(saved).toMatchObject({ decision: "Raise by 5%", throughTurn: 2 });
    expect(typeof saved!.generatedAt).toBe("number");

    store = await boot();
    expect(store.getMeeting(m.id)!.summary).toMatchObject({ decision: "Raise by 5%", open: ["Annual plans?"], throughTurn: 2 });
    expect(store.setMeetingSummary("mtg_missing", { decision: "x", actions: [], open: [] })).toBeUndefined();
  });

  it("lists meetings newest activity first, including ones only on disk", async () => {
    vi.useFakeTimers();
    let store = await boot();
    vi.setSystemTime(1_000);
    const a = store.createMeeting(["noa"]);
    vi.setSystemTime(2_000);
    const b = store.createMeeting(["noa"]);
    vi.setSystemTime(3_000);
    const c = store.createMeeting(["noa"]);
    vi.setSystemTime(4_000);
    store.appendTurn(a.id, { kind: "ceo", text: "bump a", ts: 4_000 });

    store = await boot();
    expect(store.listMeetings().map((m) => m.id)).toEqual([a.id, c.id, b.id]);
  });

  it("deletes the record and its shared files", async () => {
    const store = await boot();
    const m = store.createMeeting(["noa"]);
    store.recordSharedFile(m.id, { filename: "x.csv", content: "a,b", summary: "x", sharedById: "noa", sharedByName: "Noa" });
    expect(store.deleteMeeting(m.id)).toBe(true);
    expect(fs.existsSync(path.join(meetingsDir(), m.id))).toBe(false);
    expect(store.getMeeting(m.id)).toBeUndefined();
    // A run still in flight can't bring it back.
    store.appendTurn(m.id, { kind: "twin", employeeId: "noa", employeeName: "Noa", text: "late", ts: 9 });
    expect(fs.existsSync(path.join(meetingsDir(), m.id))).toBe(false);
  });

  it("sweeps shared folders left by the in-memory version, keeps real meetings", async () => {
    const orphan = path.join(meetingsDir(), "mtg_1_old", "shared");
    fs.mkdirSync(orphan, { recursive: true });
    fs.writeFileSync(path.join(orphan, "leak.csv"), "x");
    const store = await boot();
    const m = store.createMeeting(["noa"]);
    expect(store.listMeetings().map((x) => x.id)).toEqual([m.id]);
    expect(fs.existsSync(path.join(meetingsDir(), "mtg_1_old"))).toBe(false);
  });
});

describe("redactEmployeeFromMeetings", () => {
  it("rewrites stored meetings: blanks turns, drops files and summaries, scrubs mentions", async () => {
    let store = await boot();
    const m = store.createMeeting(["noa", "itai"]);
    store.appendTurn(m.id, { kind: "ceo", text: "Noa, what do you think?", ts: 1 });
    store.appendTurn(m.id, { kind: "twin", employeeId: "noa", employeeName: "Noa", text: "my private view", ts: 2 });
    store.appendTurn(m.id, { kind: "twin", employeeId: "itai", employeeName: "Itai", text: "I agree with Noa", ts: 3, delegatedFromId: "noa", delegatedFromName: "Noa" });
    store.recordSharedFile(m.id, { filename: "noa.csv", content: "secret", summary: "Noa's numbers", sharedById: "noa", sharedByName: "Noa" });
    store.recordSharedFile(m.id, { filename: "itai.csv", content: "ok", summary: "from Noa's sheet", sharedById: "itai", sharedByName: "Itai" });
    store.setMeetingSummary(m.id, { decision: "Go with Noa's plan", actions: [{ employeeId: "noa", action: "Ship it" }], open: [] });
    const other = store.createMeeting(["itai"]);
    store.appendTurn(other.id, { kind: "ceo", text: "unrelated", ts: 1 });
    store.setMeetingSummary(other.id, { decision: "Keep", actions: [], open: [] });

    // Restart first: redaction must reach meetings that are only on disk.
    store = await boot();
    const result = store.redactEmployeeFromMeetings("noa", { mentions: /(?<![\w-])(?:noa|Noa Friedman|Noa)(?![\w-])/i });
    expect(result).toEqual({ turns: 1, files: 1, meetings: 1 });

    const raw = fs.readFileSync(path.join(meetingsDir(), m.id, "meeting.json"), "utf8");
    expect(raw).not.toMatch(/my private view|Noa|"noa"/);
    const saved = JSON.parse(raw);
    expect(saved.participantIds).toEqual(["itai"]);
    expect(saved.summary).toBeUndefined();
    expect(saved.title).toBe("[former employee], what do you think?");
    expect(saved.transcript[2]).toMatchObject({ employeeId: "itai", text: "I agree with [former employee]", delegatedFromName: "[deleted]" });
    expect(saved.transcript[2].delegatedFromId).toBeUndefined();
    expect(saved.sharedFiles.map((f: { filename: string }) => f.filename)).toEqual(["itai.csv"]);
    expect(fs.existsSync(path.join(meetingsDir(), m.id, "shared", "noa.csv"))).toBe(false);
    expect(fs.existsSync(path.join(meetingsDir(), m.id, "shared", "itai.csv"))).toBe(true);

    // Meetings they had no part in keep their summary.
    expect(onDisk(other.id).summary).toMatchObject({ decision: "Keep" });

    store = await boot();
    expect(JSON.stringify(store.getMeeting(m.id))).not.toContain("my private view");
  });
});
