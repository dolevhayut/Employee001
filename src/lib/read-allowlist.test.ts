import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let home: string;
const write = (rel: string, body: unknown) => {
  const abs = path.join(home, "data", rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify(body));
};
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "e001-allow-"));
  process.env.EMPLOYEE001_HOME = home;
  vi.resetModules();
});
afterEach(() => {
  delete process.env.EMPLOYEE001_HOME;
  fs.rmSync(home, { recursive: true, force: true });
});

describe("read allowlist", () => {
  it("seeds from what the admin already connected, with web search off", async () => {
    write("org/custom-mcp.json", { servers: [{ name: "CompanySim", enabled: true }, { name: "Old", enabled: false }] });
    write("employees/noa/.composio.json", { connections: { gmail: { status: "ACTIVE" }, zoom: { status: "EXPIRED" } } });
    const { loadReadAllowlist } = await import("./read-allowlist");
    expect(loadReadAllowlist()).toEqual({ servers: ["companysim"], composioToolkits: ["gmail"], webSearch: false, webOverrides: false });
    expect(fs.existsSync(path.join(home, "data", "org", "read-allowlist.json"))).toBe(true);
    const audit = fs.readFileSync(path.join(home, "data", "audit.jsonl"), "utf8");
    expect(audit).toContain("readAllowlistSeeded");
  });

  it("saves only well-formed entries and audits who changed it", async () => {
    const { saveReadAllowlist } = await import("./read-allowlist");
    expect(saveReadAllowlist({ servers: ["CompanySim", "../etc"], composioToolkits: ["github"], webSearch: true, webOverrides: "yes" }, "user_1"))
      .toEqual({ servers: ["companysim"], composioToolkits: ["github"], webSearch: true, webOverrides: false });
    const row = JSON.parse(fs.readFileSync(path.join(home, "data", "audit.jsonl"), "utf8").trim());
    expect(row).toMatchObject({ bareName: "readAllowlistUpdated", approvedBy: "user_1" });
  });
});
