import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildDemoChildEnv, createDemoHome, parseDemoArgs } from "../../bin/commands/demo.mjs";

const tempDirs: string[] = [];

function tempDir() {
  const dir = fs.mkdtempSync(join(tmpdir(), "employee001-demo-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("employee001 demo", () => {
  it("parses its small, explicit flag surface", () => {
    expect(parseDemoArgs([])).toEqual({ port: 3100, noOpen: false, keep: false, live: false });
    expect(parseDemoArgs(["--port", "4123", "--no-open", "--keep", "--live"])).toEqual({ port: 4123, noOpen: true, keep: true, live: true });
    expect(() => parseDemoArgs(["--port", "0"])).toThrow(/1 to 65535/);
    expect(() => parseDemoArgs(["--unknown"])).toThrow(/Unknown demo option/);
  });

  it("does not pass a shell API key into replay mode", () => {
    const parentEnv = { PATH: "/usr/bin", LANG: "en_US.UTF-8", ANTHROPIC_API_KEY: "would-spend", OTHER_SECRET: "nope" };
    const env = buildDemoChildEnv({ home: "/tmp/demo", port: 3100, parentEnv, recordingPath: "/tmp/recording.json" });

    expect(env).not.toHaveProperty("ANTHROPIC_API_KEY");
    expect(env).not.toHaveProperty("OTHER_SECRET");
    expect(env).toMatchObject({ EMPLOYEE001_DEMO: "1", EMPLOYEE001_HOME: "/tmp/demo" });
    expect(buildDemoChildEnv({ home: "/tmp/demo", port: 3100, live: true, parentEnv, recordingPath: "/tmp/recording.json" })).toMatchObject({ ANTHROPIC_API_KEY: "would-spend", EMPLOYEE001_DEMO_LIVE: "1" });
  });

  it("copies only the shipped fixture and writes a keyless demo .env", () => {
    const pkgRoot = tempDir();
    const fixture = join(pkgRoot, "bin", "demo", "data", "employees", "maya");
    fs.mkdirSync(fixture, { recursive: true });
    fs.writeFileSync(join(fixture, "employee.json"), '{"id":"maya"}');

    const home = createDemoHome({ pkgRoot, port: 4111 });
    tempDirs.push(home);
    expect(fs.readFileSync(join(home, ".env"), "utf8")).toBe("PORT=4111\nEMPLOYEE001_DEMO=1\nEMPLOYEE001_BIND=127.0.0.1\n");
    expect(fs.existsSync(join(home, "data", "employees", "maya", "employee.json"))).toBe(true);
  });
});
