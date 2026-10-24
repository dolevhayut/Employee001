// Regression: ISSUE-002 — a retired twin's task was queued and acknowledged
// ("On it"), then skipped by the dispatcher.
// Found by /qa on 2026-10-24
// Report: .gstack/qa-reports/qa-report-localhost-2026-10-24.md
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/routine-scheduler", () => ({ ensureSchedulerStarted: () => {} }));
vi.mock("@/lib/work-dispatcher", () => ({ dispatchWorkTick: async () => {} }));

let home: string;
function twin(id: string, body: Record<string, unknown> = {}) {
  const file = path.join(home, "data", "employees", id, "employee.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ id, name: id, role: "QA", ...body }));
}
const post = (body: Record<string, unknown>) =>
  new Request("http://localhost/api/work-items", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "e001-work-items-"));
  process.env.EMPLOYEE001_HOME = home;
  vi.resetModules();
});
afterEach(() => {
  delete process.env.EMPLOYEE001_HOME;
  fs.rmSync(home, { recursive: true, force: true });
});

describe("POST /api/work-items", () => {
  it("refuses a task for a retired twin and queues nothing", async () => {
    twin("dana", { lifecycle: "retired" });
    const { POST } = await import("./route");
    const { listWorkItems } = await import("@/lib/work-items");
    const res = await POST(post({ assigneeEmployeeId: "dana", title: "Draft a checklist", task: "Draft it" }) as never);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/has left/);
    expect(listWorkItems().filter((i) => i.assigneeEmployeeId === "dana")).toHaveLength(0);
  });

  it("still queues a task for an active or handover twin", async () => {
    twin("noa");
    twin("eli", { lifecycle: "handover" });
    const { POST } = await import("./route");
    for (const id of ["noa", "eli"]) {
      const res = await POST(post({ assigneeEmployeeId: id, title: `Task for ${id}`, task: "Do it" }) as never);
      expect(res.status).toBe(201);
    }
  });
});
