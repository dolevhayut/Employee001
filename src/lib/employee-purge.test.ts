import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const composio = vi.hoisted(() => ({ disconnectAllToolkits: vi.fn(async () => 2) }));
vi.mock("./composio-client", () => composio);

const ME = "noa-friedman";
const PEER = "itai-cohen";
let home: string;

function write(rel: string, content: string) {
  const abs = path.join(home, "data", rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}
const exists = (rel: string) => fs.existsSync(path.join(home, "data", rel));
const read = (rel: string) => fs.readFileSync(path.join(home, "data", rel), "utf8");
const jsonl = (...rows: unknown[]) => rows.map((r) => JSON.stringify(r)).join("\n") + "\n";

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "employee001-purge-"));
  process.env.EMPLOYEE001_HOME = home;
  vi.resetModules();
  composio.disconnectAllToolkits.mockClear();
  composio.disconnectAllToolkits.mockResolvedValue(2);

  for (const id of [ME, PEER]) {
    write(`employees/${id}/CONTEXT.md`, "profile");
    write(`employees/${id}/chat-history.jsonl`, "{}\n");
    write(`memory/${id}/cards.jsonl`, "{}\n");
    write(`scratch/${id}/memo.md`, "note");
    write(`relay/transcripts/${id}.json`, "{}");
    write(`shifts/shift_${id}_1/events.jsonl`, "{}\n");
    write(`run-logs/council/council_${id}_1.ndjson`, "{}\n");
  }
  write("handovers/" + ME + "/rcp.json", "{}");
  write("relay/hand_a_1/events.jsonl", jsonl({ type: "start", employeeId: ME }));
  write("relay/hand_b_2/events.jsonl", jsonl({ type: "start", employeeId: PEER }));
  write("run-logs/routine/rt_r1_5.ndjson", "{}\n");
  write("task-history.jsonl", jsonl({ id: "rt_r1_5", employeeId: ME }, { id: "chat_x", employeeId: PEER }));
  write("org/feed.jsonl", jsonl({ id: "f1", source: { employeeId: ME } }, { id: "f2", source: { employeeId: PEER } }));
  write("routines.json", JSON.stringify([{ id: "r1", employeeId: ME }, { id: "r2", employeeId: PEER }]));
  write("invites.json", JSON.stringify([{ token: "a", employeeId: ME }, { token: "b" }]));
  write("active-runs.json", JSON.stringify({ run1: { employeeId: ME }, run2: { employeeId: PEER } }));
  write("email-poll.json", JSON.stringify({ [ME]: { lastPollAt: "x" }, [PEER]: { lastPollAt: "y" } }));
  write("goals.json", JSON.stringify([{ id: "g1", ownerEmployeeId: ME }, { id: "g2", ownerEmployeeId: PEER }]));
  write("org/email-triggers.json", JSON.stringify({ [ME]: { id: "t1" }, [PEER]: { id: "t2" } }));
  write("org/slack-triggers.json", JSON.stringify({ [ME]: { id: "t3" } }));
  write("slack-poll.json", JSON.stringify({ [ME]: { lastPollAt: "x" } }));
  write("slack-reply-rate.json", JSON.stringify({ [`${ME}:C1`]: [1], [`${PEER}:C1`]: [2] }));
});

afterEach(() => {
  delete process.env.EMPLOYEE001_HOME;
  fs.rmSync(home, { recursive: true, force: true });
});

describe("purgeEmployee", () => {
  it("removes every trace of the employee and leaves colleagues intact", async () => {
    const { purgeEmployee } = await import("./employee-purge");
    const report = await purgeEmployee(ME);

    expect(report.complete).toBe(true);
    expect(composio.disconnectAllToolkits).toHaveBeenCalledWith(ME);
    for (const rel of [
      `employees/${ME}`,
      `memory/${ME}`,
      `scratch/${ME}`,
      `handovers/${ME}`,
      `relay/transcripts/${ME}.json`,
      "relay/hand_a_1",
      `shifts/shift_${ME}_1`,
      `run-logs/council/council_${ME}_1.ndjson`,
      "run-logs/routine/rt_r1_5.ndjson",
    ]) {
      expect(exists(rel), rel).toBe(false);
    }
    for (const rel of [`employees/${PEER}/CONTEXT.md`, `memory/${PEER}`, "relay/hand_b_2", `shifts/shift_${PEER}_1`]) {
      expect(exists(rel), rel).toBe(true);
    }

    expect(read("task-history.jsonl")).not.toContain(ME);
    expect(read("org/feed.jsonl")).not.toContain(ME);
    expect(read("routines.json")).not.toContain(ME);
    expect(read("invites.json")).not.toContain(ME);
    expect(read("active-runs.json")).not.toContain(ME);
    expect(read("email-poll.json")).not.toContain(ME);
    for (const f of ["org/email-triggers.json", "org/slack-triggers.json", "slack-poll.json", "slack-reply-rate.json"]) {
      expect(read(f), f).not.toContain(ME);
    }
    expect(read("slack-reply-rate.json")).toContain(PEER);
    expect(JSON.parse(read("goals.json"))).toEqual([
      { id: "g1", ownerEmployeeId: null },
      { id: "g2", ownerEmployeeId: PEER },
    ]);
    expect(read("task-history.jsonl")).toContain(PEER);
  });

  it("redacts the employee's audit inputs and keeps the chain verifiable", async () => {
    const audit = await import("./audit-log");
    audit.appendAuditEntry({
      runId: "r", employeeId: ME, employeeName: "Noa Friedman", toolName: "GMAIL_SEND_EMAIL",
      bareName: "GMAIL_SEND_EMAIL", input: { to: "doctor@clinic.example", body: "sick leave" }, verdict: "executed",
    });
    audit.appendAuditEntry({
      runId: "r", employeeId: PEER, employeeName: "Itai", toolName: "Read",
      bareName: "Read", input: { file_path: "a.md" }, verdict: "executed",
    });
    const { purgeEmployee } = await import("./employee-purge");
    await purgeEmployee(ME);

    const log = read("audit.jsonl");
    expect(log).not.toContain("sick leave");
    expect(log).not.toContain("Noa Friedman");
    expect(log).toContain("a.md");
    expect(log).toContain("purgeEmployee");
    expect(audit.verifyAuditChain()).toMatchObject({ ok: true });
  });

  it("fails verification when a row is marked redacted without a purge record", async () => {
    const audit = await import("./audit-log");
    audit.appendAuditEntry({
      runId: "r", employeeId: ME, employeeName: "Noa", toolName: "Read",
      bareName: "Read", input: { secret: 1 }, verdict: "executed",
    });
    audit.redactEmployeeAudit(ME);
    expect(audit.verifyAuditChain()).toMatchObject({ ok: false, reason: "redacted row without a purge record" });
  });

  it("reports incomplete and keeps going when Composio can't be reached", async () => {
    composio.disconnectAllToolkits.mockRejectedValueOnce(new Error("network down"));
    const { purgeEmployee } = await import("./employee-purge");
    const report = await purgeEmployee(ME);

    expect(report.complete).toBe(false);
    expect(report.steps.find((s) => s.target === "composio connections")).toMatchObject({ status: "error" });
    expect(exists(`memory/${ME}`)).toBe(false);
  });

  it("never deletes another employee's runs whose id contains this one", async () => {
    write("run-logs/council/run_noa-friedman-2_9.ndjson", "{}\n");
    write(`run-logs/council/run_${PEER}_9__consult_${ME}_d1.ndjson`, "{}\n");
    const { purgeEmployee } = await import("./employee-purge");
    await purgeEmployee(ME);
    expect(exists("run-logs/council/run_noa-friedman-2_9.ndjson")).toBe(true);
    expect(exists(`run-logs/council/run_${PEER}_9__consult_${ME}_d1.ndjson`)).toBe(true);
  });

  it("covers rows a failed earlier attempt already redacted, and legacy rows", async () => {
    const audit = await import("./audit-log");
    // A legacy row from before digests: hashed over the full input.
    write("audit.jsonl", "");
    audit.appendAuditEntry({
      runId: "r", employeeId: ME, employeeName: "Noa", toolName: "Read",
      bareName: "Read", input: { secret: 1 }, verdict: "executed",
    });
    audit.appendAuditEntry({
      runId: "r", employeeId: ME, employeeName: "Noa", toolName: "Read",
      bareName: "Read", input: { secret: 2 }, verdict: "executed",
    });
    // First attempt redacts but its purge record never lands.
    audit.redactEmployeeAudit(ME);
    expect(audit.verifyAuditChain()).toMatchObject({ ok: false });
    // The retry must still vouch for both rows.
    const { purgeEmployee } = await import("./employee-purge");
    await purgeEmployee(ME);
    expect(audit.verifyAuditChain()).toMatchObject({ ok: true });
  });

  it("refuses ids that could escape the data folder", async () => {
    const { purgeEmployee } = await import("./employee-purge");
    await expect(purgeEmployee("../etc")).rejects.toThrow();
    await expect(purgeEmployee("a/b")).rejects.toThrow();
  });
});
