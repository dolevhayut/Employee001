import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";

import { appHome, dataDir, envFilePath } from "./app-home";

const originalHome = process.env.EMPLOYEE001_HOME;
const originalEnvFile = process.env.EMPLOYEE001_ENV_FILE;

afterEach(() => {
  if (originalHome === undefined) delete process.env.EMPLOYEE001_HOME;
  else process.env.EMPLOYEE001_HOME = originalHome;
  if (originalEnvFile === undefined) delete process.env.EMPLOYEE001_ENV_FILE;
  else process.env.EMPLOYEE001_ENV_FILE = originalEnvFile;
});

describe("appHome", () => {
  it("puts saved keys at EMPLOYEE001_ENV_FILE when set (Docker: the data volume)", () => {
    process.env.EMPLOYEE001_ENV_FILE = "/app/data/.env";
    expect(envFilePath()).toBe(path.resolve("/app/data/.env"));
  });

  it("uses the process cwd when EMPLOYEE001_HOME is unset", () => {
    delete process.env.EMPLOYEE001_HOME;
    delete process.env.EMPLOYEE001_ENV_FILE;
    expect(appHome()).toBe(process.cwd());
    expect(envFilePath()).toBe(path.join(process.cwd(), ".env"));
  });

  it("uses the process cwd when EMPLOYEE001_HOME is empty", () => {
    process.env.EMPLOYEE001_HOME = "";
    expect(appHome()).toBe(process.cwd());
  });

  it("uses an absolute EMPLOYEE001_HOME", () => {
    process.env.EMPLOYEE001_HOME = path.join(os.tmpdir(), "e120a-home");
    expect(appHome()).toBe(path.join(os.tmpdir(), "e120a-home"));
  });

  it("resolves a relative EMPLOYEE001_HOME and joins data paths", () => {
    process.env.EMPLOYEE001_HOME = "relative-employee001-home";
    expect(appHome()).toBe(path.resolve("relative-employee001-home"));
    expect(dataDir("employees", "ada", "employee.json")).toBe(
      path.join(path.resolve("relative-employee001-home"), "data", "employees", "ada", "employee.json"),
    );
  });
});
