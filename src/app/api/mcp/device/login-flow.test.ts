import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveBearer } from "@/lib/mcp-server/device-auth";
import { readStoredSession, runLogin } from "../../../../../bin/commands/login.mjs";
import { POST as start } from "./start/route";
import { POST as poll } from "./poll/route";
import { POST as approve } from "./approve/route";
import { resetSlots } from "./respond";

let home: string;
const prevHome = process.env.EMPLOYEE001_HOME;

beforeEach(() => {
  resetSlots();
  home = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-login-flow-"));
  process.env.EMPLOYEE001_HOME = home;
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.EMPLOYEE001_HOME;
  else process.env.EMPLOYEE001_HOME = prevHome;
  fs.rmSync(home, { recursive: true, force: true });
});

describe("employee001 login against the real device routes", () => {
  it("receives a session owned by the person who approved the printed code", async () => {
    const env = { EMPLOYEE001_MCP_SESSION_FILE: path.join(home, "mcp-session.json") };
    let printed = "";
    // The app routes stand in for the server; the "browser" approves with the
    // code the command printed, as a signed-in member.
    const fetchFn = (async (url: string, init: RequestInit) => {
      const request = new Request(url, init);
      if (url.endsWith("/start")) return start(request);
      return poll(request);
    }) as unknown as typeof fetch;

    const result = await runLogin({
      base: "http://localhost:3000",
      env,
      fetchFn,
      write: (text) => void (printed += text),
      sleep: async () => {
        const code = printed.match(/code: ([A-Z0-9]{4}-[A-Z0-9]{4})/)?.[1];
        expect(code).toBeTruthy();
        const res = await approve(
          new Request("http://localhost:3000/api/mcp/device/approve", {
            method: "POST",
            headers: { "content-type": "application/json", "x-e001-user-id": "ada", "x-e001-user-role": "member" },
            body: JSON.stringify({ user_code: code }),
          }),
        );
        expect(res.status).toBe(200);
        await new Promise((r) => setTimeout(r, 5100)); // the poll interval the server enforces
      },
    });

    expect(result.ok).toBe(true);
    const stored = readStoredSession(env);
    expect(stored?.url).toBe("http://localhost:3000/api/mcp");
    expect(resolveBearer(stored!.token)?.personId).toBe("ada");
    expect(printed).toContain("http://localhost:3000/device?code=");
  }, 15_000);
});
