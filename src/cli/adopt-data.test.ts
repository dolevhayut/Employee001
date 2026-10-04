import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { adoptData } from "../../bin/lib/adopt-data.mjs";
import { buildChildEnv } from "../../bin/commands/start.mjs";

const tempDirs: string[] = [];

function makeTempDir() {
  const dir = fs.mkdtempSync(join(tmpdir(), "employee001-adopt-"));
  tempDirs.push(dir);
  return dir;
}

function addTwin(dataDir: string, id: string, mtimeMs?: number) {
  const employees = join(dataDir, "employees");
  const twinDir = join(employees, id);
  fs.mkdirSync(twinDir, { recursive: true });
  fs.writeFileSync(join(twinDir, "employee.json"), JSON.stringify({ id }));
  if (mtimeMs) fs.utimesSync(employees, mtimeMs / 1000, mtimeMs / 1000);
  return twinDir;
}

function npxData(cache: string, entry: string) {
  return join(cache, "_npx", entry, "node_modules", "employee001", ".next", "standalone", "data");
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("adoptData", () => {
  it("does nothing when the target already has twins", () => {
    const root = makeTempDir();
    const home = join(root, "home");
    const pkgRoot = join(root, "package");
    addTwin(join(home, "data"), "current");
    addTwin(join(pkgRoot, ".next", "standalone", "data"), "older");

    expect(adoptData({ home, pkgRoot, npmCache: join(root, "cache") })).toEqual({ adopted: false });
    expect(fs.existsSync(join(home, "data", "employees", "older"))).toBe(false);
  });

  it("does nothing when no older install has twins", () => {
    const root = makeTempDir();
    const home = join(root, "home");

    expect(adoptData({ home, pkgRoot: join(root, "package"), npmCache: join(root, "cache") })).toEqual({ adopted: false });
    expect(fs.existsSync(join(home, "data"))).toBe(false);
  });

  it("picks the newest employees directory across package and npx installs", () => {
    const root = makeTempDir();
    const home = join(root, "home");
    const pkgRoot = join(root, "package");
    const cache = join(root, "cache");
    addTwin(join(pkgRoot, ".next", "standalone", "data"), "packaged", 1_000);
    addTwin(npxData(cache, "old"), "old", 2_000);
    const newest = npxData(cache, "new");
    addTwin(newest, "newest", 3_000);

    const result = adoptData({ home, pkgRoot, npmCache: cache });

    expect(result).toMatchObject({ adopted: true, source: newest, target: join(home, "data") });
    expect(fs.existsSync(join(home, "data", "employees", "newest", "employee.json"))).toBe(true);
    expect(fs.existsSync(join(home, "data", "employees", "old"))).toBe(false);
  });

  it("copies without touching the source", () => {
    const root = makeTempDir();
    const home = join(root, "home");
    const pkgRoot = join(root, "package");
    const source = join(pkgRoot, ".next", "standalone", "data");
    const sourceTwin = addTwin(source, "source");
    fs.writeFileSync(join(sourceTwin, "note.txt"), "keep me");
    fs.mkdirSync(join(home, "data"), { recursive: true });

    expect(adoptData({ home, pkgRoot, npmCache: join(root, "cache") }).adopted).toBe(true);
    expect(fs.readFileSync(join(sourceTwin, "note.txt"), "utf8")).toBe("keep me");
    expect(fs.existsSync(join(home, "data", "employees", "source", "employee.json"))).toBe(true);
  });

  it("does nothing in demo mode", () => {
    const root = makeTempDir();
    const home = join(root, "home");
    const pkgRoot = join(root, "package");
    addTwin(join(pkgRoot, ".next", "standalone", "data"), "older");

    expect(adoptData({ home, pkgRoot, env: { EMPLOYEE001_DEMO: "1" } })).toEqual({ adopted: false });
    expect(fs.existsSync(join(home, "data"))).toBe(false);
  });

  it("skips an unreadable candidate", () => {
    const root = makeTempDir();
    const home = join(root, "home");
    const pkgRoot = join(root, "package");
    const cache = join(root, "cache");
    const unreadable = npxData(cache, "unreadable");
    addTwin(unreadable, "hidden");
    const unreadableEmployees = join(unreadable, "employees");
    const injectedFs = {
      ...fs,
      readdirSync(path: fs.PathLike, options?: fs.ObjectEncodingOptions & { withFileTypes?: boolean }) {
        if (path === unreadableEmployees) {
          const error = new Error("permission denied") as NodeJS.ErrnoException;
          error.code = "EACCES";
          throw error;
        }
        return fs.readdirSync(path, options as { withFileTypes: true });
      },
    };

    expect(adoptData({ home, pkgRoot, npmCache: cache, fs: injectedFs }).adopted).toBe(false);
    expect(fs.existsSync(join(home, "data"))).toBe(false);
  });
});

describe("buildChildEnv", () => {
  it("maps the launch arguments to the child environment", () => {
    const env = buildChildEnv({
      home: "relative-home",
      port: 4123,
      bind: "0.0.0.0",
      env: { CUSTOM: "value", EMPLOYEE001_HOME: "ignored" },
      strict: true,
    });

    expect(env).toMatchObject({
      CUSTOM: "value",
      EMPLOYEE001_HOME: join(process.cwd(), "relative-home"),
      HOSTNAME: "0.0.0.0",
      PORT: "4123",
      NODE_ENV: "production",
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    });
  });
});
