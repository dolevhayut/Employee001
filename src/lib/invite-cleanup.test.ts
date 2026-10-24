import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let home: string;
const write = (rel: string, data: unknown) => {
  const file = path.join(home, "data", rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data));
};

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "e001-invclean-"));
  process.env.EMPLOYEE001_HOME = home;
});
afterEach(() => {
  delete process.env.EMPLOYEE001_HOME;
  fs.rmSync(home, { recursive: true, force: true });
});

describe("abandoned invite folders", () => {
  it("finds folders from revoked or expired invites that never recorded consent", async () => {
    const past = new Date(Date.now() - 86_400_000).toISOString();
    const future = new Date(Date.now() + 86_400_000).toISOString();
    write("invites.json", [
      { token: "inv_expired", createdAt: past, expiresAt: past },
      { token: "inv_open", createdAt: past, expiresAt: future },
      { token: "inv_done", createdAt: past, expiresAt: past, completedAt: past, employeeId: "noa-done" },
    ]);
    write("employees/dana-expired/employee.json", { id: "dana-expired", name: "Dana", via: { invite: "inv_expired" }, pendingProfile: true });
    write("employees/eli-revoked/employee.json", { id: "eli-revoked", name: "Eli", via: { invite: "inv_gone" } });
    write("employees/rina-open/employee.json", { id: "rina-open", name: "Rina", via: { invite: "inv_open" }, pendingProfile: true });
    write("employees/noa-done/employee.json", { id: "noa-done", name: "Noa", via: { invite: "inv_done" }, consent: { scopes: ["data-collection"] } });
    write("employees/self-built/employee.json", { id: "self-built", name: "Me", via: { self: true }, consent: { scopes: ["data-collection"] } });

    const { abandonedInviteTwins } = await import("./invite-cleanup");
    expect(abandonedInviteTwins().sort()).toEqual(["dana-expired", "eli-revoked"]);
  });
});
