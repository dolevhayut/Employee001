import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { USER_ID_HEADER, USER_ROLE_HEADER } from "@/lib/auth/request-user";

const rows: Array<Record<string, unknown>> = [];
vi.mock("@/lib/audit-log", () => ({ appendAuditEntry: (row: Record<string, unknown>) => rows.push(row) }));
vi.mock("@/lib/employees-disk", () => ({ loadEmployeesFromDisk: async () => [] }));
vi.mock("@/lib/hired-agents", () => ({ getHiredEmployees: () => [] }));

let home: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "employee001-meeting-route-"));
  process.env.EMPLOYEE001_HOME = home;
  rows.length = 0;
  vi.resetModules();
});

afterEach(() => {
  delete process.env.EMPLOYEE001_HOME;
  fs.rmSync(home, { recursive: true, force: true });
});

async function setup() {
  const store = await import("@/lib/meeting-store");
  const { PATCH } = await import("./route");
  const m = store.createMeeting(["noa"]);
  const patch = (id: string, body: unknown, role?: string) =>
    PATCH(
      new Request(`http://x/api/council/meetings/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", ...(role ? { [USER_ID_HEADER]: "u1", [USER_ROLE_HEADER]: role } : {}) },
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
      { params: Promise.resolve({ id }) },
    );
  return { store, m, patch };
}

describe("PATCH /api/council/meetings/[id] (Don't remember)", () => {
  it("rejects a body without a boolean and an unknown meeting", async () => {
    const { m, patch } = await setup();
    expect((await patch(m.id, { forget: "yes" })).status).toBe(400);
    expect((await patch(m.id, "not json")).status).toBe(400);
    expect((await patch("mtg_1_zzzzzz", { forget: true })).status).toBe(404);
    expect(rows).toHaveLength(0);
  });

  it("lets a member keep a meeting out of memory, audited", async () => {
    const { m, patch } = await setup();
    const res = await patch(m.id, { forget: true }, "member");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ forget: true, digest: null });
    expect(rows).toEqual([expect.objectContaining({ toolName: "meeting.forget", input: { meetingId: m.id, forget: true }, approvedBy: "u1" })]);
  });

  it("only lets an admin bring a meeting back into memory", async () => {
    const { store, m, patch } = await setup();
    store.setMeetingForget(m.id, true);
    expect((await patch(m.id, { forget: false }, "member")).status).toBe(403);
    expect(store.getMeeting(m.id)!.forget).toBe(true);
    expect((await patch(m.id, { forget: false }, "admin")).status).toBe(200);
    expect(store.getMeeting(m.id)!.forget).toBeUndefined();
  });
});
