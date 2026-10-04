import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createKeychain, KEYCHAIN_PLACEHOLDER, resolveEnvPlaceholders } from "../../bin/lib/keychain.mjs";
import { migratePlaintextSecrets } from "../../bin/commands/secure.mjs";
import { plaintextSecretNames } from "../../bin/commands/doctor.mjs";
import { buildChildEnv } from "../../bin/commands/start.mjs";

const dirs: string[] = [];

function tempDir() {
  const dir = fs.mkdtempSync(join(tmpdir(), "employee001-keychain-"));
  dirs.push(dir);
  return dir;
}

function fakeKeychain() {
  const values = new Map<string, string>();
  return {
    kind: "fake",
    available: true,
    store: (name: string, value: string) => { values.set(name, value); return true; },
    read: (name: string) => values.get(name) ?? null,
  };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("OS keychain adapter", () => {
  it("stores and reads through macOS security without a shell", () => {
    const calls: Array<{ file: string; args: string[] }> = [];
    const keychain = createKeychain({
      platform: "darwin",
      exists: () => true,
      runner: ((file: string, args: string[]) => {
        calls.push({ file, args });
        if (args[0] === "find-generic-password") return "secret-value\n";
        return "";
      }) as never,
    });

    expect(keychain.store("ANTHROPIC_API_KEY", "secret-value")).toBe(true);
    expect(keychain.read("ANTHROPIC_API_KEY")).toBe("secret-value");
    expect(calls[0]).toEqual({
      file: "/usr/bin/security",
      args: ["add-generic-password", "-U", "-a", "employee001", "-s", "employee001:ANTHROPIC_API_KEY", "-w", "secret-value"],
    });
  });

  it("uses secret-tool on Linux and reports unsupported platforms", () => {
    const linuxCalls: string[][] = [];
    const linux = createKeychain({
      platform: "linux",
      path: "/fake",
      access: () => undefined,
      runner: ((_file: string, args: string[]) => { linuxCalls.push(args); return args[0] === "lookup" ? "linux-secret\n" : ""; }) as never,
    });
    expect(linux.available).toBe(true);
    expect(linux.store("OPENAI_API_KEY", "linux-secret")).toBe(true);
    expect(linux.read("OPENAI_API_KEY")).toBe("linux-secret");
    expect(linuxCalls[0][0]).toBe("store");

    const unsupported = createKeychain({ platform: "win32" });
    expect(unsupported.available).toBe(false);
    expect(unsupported.store("OPENAI_API_KEY", "never-stored")).toBe(false);
    expect(unsupported.read("OPENAI_API_KEY")).toBeNull();
  });
});

describe("placeholder handling", () => {
  it("resolves available values and removes missing ones from the child env", () => {
    const { env, missing } = resolveEnvPlaceholders({
      ANTHROPIC_API_KEY: KEYCHAIN_PLACEHOLDER,
      OPENAI_API_KEY: KEYCHAIN_PLACEHOLDER,
      PORT: "4200",
    }, { read: (name: string) => name === "ANTHROPIC_API_KEY" ? "stored-key" : null });

    expect(env).toEqual({ ANTHROPIC_API_KEY: "stored-key", PORT: "4200" });
    expect(missing).toEqual(["OPENAI_API_KEY"]);
    const child = buildChildEnv({ home: ".", port: 4200, bind: "127.0.0.1", env: { ...env, OPENAI_API_KEY: undefined }, inheritEnv: false });
    expect(child["OPENAI_API_KEY" as keyof typeof child]).toBeUndefined();
  });
});

describe("employee001 secure", () => {
  it("leaves .env untouched when confirmation is declined", async () => {
    const cwd = tempDir();
    const source = "ANTHROPIC_API_KEY=plaintext\nPORT=3000\n";
    fs.writeFileSync(join(cwd, ".env"), source);
    const keychain = fakeKeychain();

    await expect(migratePlaintextSecrets({ cwd, keychain, confirm: async () => false, isCancel: (() => false) as never })).resolves.toEqual({ status: "cancelled", migrated: [] });
    expect(fs.readFileSync(join(cwd, ".env"), "utf8")).toBe(source);
    expect(fs.existsSync(join(cwd, ".env.bak"))).toBe(false);
  });

  it("backs up once and replaces only verified values", async () => {
    const cwd = tempDir();
    fs.writeFileSync(join(cwd, ".env"), "ANTHROPIC_API_KEY=plaintext\nPORT=3000\n");
    const keychain = fakeKeychain();
    const result = await migratePlaintextSecrets({ cwd, keychain, confirm: async () => true, isCancel: (() => false) as never });
    expect(result).toEqual({ status: "migrated", migrated: ["ANTHROPIC_API_KEY"] });
    expect(fs.readFileSync(join(cwd, ".env"), "utf8")).toContain("ANTHROPIC_API_KEY=@keychain");
    expect(fs.readFileSync(join(cwd, ".env.bak"), "utf8")).toContain("ANTHROPIC_API_KEY=plaintext");
    expect(fs.statSync(join(cwd, ".env.bak")).mode & 0o777).toBe(0o600);
  });
});

it("reports only plaintext secret names for doctor", () => {
  expect(plaintextSecretNames({ ANTHROPIC_API_KEY: "plain", OPENAI_API_KEY: "@keychain", PORT: "3000" })).toEqual(["ANTHROPIC_API_KEY"]);
});
