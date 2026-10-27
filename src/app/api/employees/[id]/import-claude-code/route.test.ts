import { describe, expect, it, vi } from "vitest";
import { API_ROUTES, authorizeApi } from "@/lib/auth/rbac";

vi.mock("@/lib/employees-files", () => ({ employeeExists: (id: string) => id !== "ghost" }));
vi.mock("@/lib/employees", () => ({ getEmployee: () => ({ name: "Ada" }) }));
vi.mock("@/lib/twin-lifecycle", () => ({ isRetiredSync: (id: string) => id === "gone" }));
const { previewMock, applyMock } = vi.hoisted(() => ({
  previewMock: vi.fn().mockResolvedValue({ sourcePath: "/x/.claude", items: [], skipped: [], counts: {}, digest: "d", notice: "n" }),
  applyMock: vi.fn(),
}));
vi.mock("@/lib/claude-code-import", async (orig) => {
  const real = await orig<typeof import("@/lib/claude-code-import")>();
  applyMock.mockImplementation(async (opts: { previewDigest: string }) => {
    if (opts.previewDigest !== "d") throw new real.ImportChangedError();
    return { imported: {}, skippedExisting: 0, auditRecorded: true };
  });
  return { ...real, previewClaudeCodeImport: previewMock, applyClaudeCodeImport: applyMock };
});

import { POST } from "./route";

const call = (id: string, body: unknown) =>
  POST(new Request("http://x", { method: "POST", body: JSON.stringify(body) }) as never, { params: Promise.resolve({ id }) });

describe("POST /api/employees/[id]/import-claude-code", () => {
  it("404s an unknown twin and refuses a retired twin before preview and apply", async () => {
    expect((await call("ghost", {})).status).toBe(404);
    expect((await call("gone", {})).status).toBe(409);
    expect((await call("gone", { previewDigest: "d" })).status).toBe(409);
    expect(previewMock).not.toHaveBeenCalled();
    expect(applyMock).not.toHaveBeenCalled();
  });

  it("previews without a digest, 409s a stale digest, and ignores a client-sent path", async () => {
    expect((await call("emp", { sourceDir: "/etc/.claude" })).status).toBe(200);
    expect(previewMock).toHaveBeenCalledWith("emp", undefined);
    expect((await call("emp", { previewDigest: "stale" })).status).toBe(409);
    expect((await call("emp", { previewDigest: "d" })).status).toBe(200);
  });

  it("is admin-only", () => {
    expect(API_ROUTES["/api/employees/[id]/import-claude-code"]?.POST).toEqual({ kind: "role", min: "admin" });
    expect(authorizeApi("/api/employees/e1/import-claude-code", "POST", { id: "u", role: "member" }).allow).toBe(false);
  });
});
