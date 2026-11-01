import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { auditMock } = vi.hoisted(() => ({ auditMock: vi.fn() }));
vi.mock("@/lib/audit-log", () => ({ appendAuditEntry: auditMock }));

import { PATCH } from "./route";

let home: string;
const prevHome = process.env.EMPLOYEE001_HOME;
const sidecarPath = () => path.join(home, "data", "employees", "ava-1a2b3c", "employee.json");
const sidecar = () => JSON.parse(fs.readFileSync(sidecarPath(), "utf8")) as Record<string, unknown>;

const patch = (body: unknown, id = "ava-1a2b3c") =>
  PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });

beforeAll(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "emp-patch-"));
  process.env.EMPLOYEE001_HOME = home;
});
afterAll(() => {
  if (prevHome === undefined) delete process.env.EMPLOYEE001_HOME;
  else process.env.EMPLOYEE001_HOME = prevHome;
  fs.rmSync(home, { recursive: true, force: true });
});
beforeEach(() => {
  auditMock.mockClear();
  fs.mkdirSync(path.dirname(sidecarPath()), { recursive: true });
  fs.writeFileSync(
    sidecarPath(),
    JSON.stringify({ id: "ava-1a2b3c", name: "Ava Chn", role: "Head of Sucess", via: { self: true }, consent: { version: 1 } }),
  );
});

describe("PATCH /api/employees/[id] name and role", () => {
  it("saves a corrected name and role and keeps the other fields", async () => {
    const res = await patch({ name: "  Ava\tChen ", role: "Head of\nSuccess" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, name: "Ava Chen", role: "Head of Success" });
    expect(sidecar()).toMatchObject({ name: "Ava Chen", role: "Head of Success", via: { self: true }, consent: { version: 1 } });
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: "employee.update_profile", employeeName: "Ava Chen" }),
    );
  });

  it("changes only the field that was sent", async () => {
    expect((await patch({ role: "VP Customer Success" })).status).toBe(200);
    expect(sidecar()).toMatchObject({ name: "Ava Chn", role: "VP Customer Success" });
  });

  it("refuses an empty or non-string name or role and leaves the file alone", async () => {
    const before = fs.readFileSync(sidecarPath(), "utf8");
    expect((await patch({ name: "   " })).status).toBe(400);
    expect((await patch({ role: "\u0007" })).status).toBe(400);
    expect((await patch({ name: 42 })).status).toBe(400);
    expect(fs.readFileSync(sidecarPath(), "utf8")).toBe(before);
    expect(auditMock).not.toHaveBeenCalled();
  });

  it("caps a long name at 120 characters", async () => {
    expect((await patch({ name: "A".repeat(300) })).status).toBe(200);
    expect(sidecar().name).toBe("A".repeat(120));
  });

  it("refuses to rename a retired twin", async () => {
    fs.writeFileSync(sidecarPath(), JSON.stringify({ id: "ava-1a2b3c", name: "Ava Chen", role: "Head of Success", lifecycle: "retired" }));
    const before = fs.readFileSync(sidecarPath(), "utf8");
    expect((await patch({ role: "CEO" })).status).toBe(409);
    expect((await patch({ name: "Someone Else", nameHe: "אווה" })).status).toBe(409);
    expect(fs.readFileSync(sidecarPath(), "utf8")).toBe(before);
  });

  it("keeps the Hebrew-name update as before", async () => {
    const res = await patch({ nameHe: "אווה" });
    expect(await res.json()).toEqual({ ok: true, nameHe: "אווה" });
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ toolName: "employee.update_name_he" }));
  });
});
