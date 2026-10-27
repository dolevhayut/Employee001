import { beforeEach, describe, expect, it, vi } from "vitest";

const revokePersonSessions = vi.fn<(id: string) => Promise<number>>(async () => 1);
const revokeUserSessions = vi.fn();
const users = new Map<string, { id: string; role: string; disabled?: boolean }>();

vi.mock("@/lib/mcp-server/device-auth", () => ({ revokePersonSessions: (id: string) => revokePersonSessions(id) }));
vi.mock("@/lib/audit-log", () => ({ appendAuditEntry: vi.fn() }));
vi.mock("@/lib/model-provider", () => ({ addPersonProblem: () => null }));
vi.mock("@/lib/auth/password", () => ({ hashPassword: (p: string) => p, passwordProblem: () => null }));
vi.mock("@/lib/auth/store", () => ({
  accountsEnabled: () => true,
  getUser: (id: string) => users.get(id),
  listUsers: () => [...users.values()],
  publicUser: (u: unknown) => u,
  revokeUserSessions: (id: string) => revokeUserSessions(id),
  updateUser: (id: string, patch: object) => {
    const next = { ...users.get(id)!, ...patch };
    users.set(id, next);
    return next;
  },
  deleteUser: (id: string) => {
    users.delete(id);
  },
}));

import { DELETE, PATCH } from "./route";

const asOwner = { "x-e001-user-id": "root", "x-e001-user-role": "owner", "content-type": "application/json" };
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const patch = (id: string, body: unknown) =>
  PATCH(new Request(`http://localhost/api/auth/users/${id}`, { method: "PATCH", headers: asOwner, body: JSON.stringify(body) }), ctx(id));

beforeEach(() => {
  revokePersonSessions.mockClear();
  revokeUserSessions.mockClear();
  users.clear();
  users.set("root", { id: "root", role: "owner" });
  users.set("ada", { id: "ada", role: "member" });
});

describe("MCP device sessions follow the user's account", () => {
  it("are revoked when the role changes", async () => {
    expect((await patch("ada", { role: "employee" })).status).toBe(200);
    expect(revokePersonSessions).toHaveBeenCalledWith("ada");
  });

  it("are revoked when the user is disabled", async () => {
    expect((await patch("ada", { disabled: true })).status).toBe(200);
    expect(revokePersonSessions).toHaveBeenCalledWith("ada");
  });

  it("are revoked when the password is reset", async () => {
    expect((await patch("ada", { password: "a-long-enough-password" })).status).toBe(200);
    expect(revokePersonSessions).toHaveBeenCalledWith("ada");
  });

  it("are kept for a change that does not touch access", async () => {
    expect((await patch("ada", { employeeId: "emp_1" })).status).toBe(200);
    expect(revokePersonSessions).not.toHaveBeenCalled();
  });

  it("are revoked when the user is deleted", async () => {
    const res = await DELETE(new Request("http://localhost/api/auth/users/ada", { method: "DELETE", headers: asOwner }), ctx("ada"));
    expect(res.status).toBe(200);
    expect(revokePersonSessions).toHaveBeenCalledWith("ada");
  });
});
