import { accessSync, constants, existsSync } from "node:fs";
import { execFileSync as nodeExecFileSync } from "node:child_process";
import { delimiter, join } from "node:path";

export const SECRET_NAMES = [
  "ANTHROPIC_API_KEY",
  "COMPOSIO_API_KEY",
  "OPENAI_API_KEY",
  "ELEVENLABS_API_KEY",
  "EMPLOYEE001_TOKEN",
];

export const KEYCHAIN_PLACEHOLDER = "@keychain";
const ACCOUNT = "employee001";

function executableOnPath(name, pathValue, access = accessSync) {
  for (const directory of String(pathValue ?? "").split(delimiter)) {
    if (!directory) continue;
    const candidate = join(directory, name);
    try {
      access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Continue searching PATH.
    }
  }
  return null;
}

function outputWithoutFinalNewline(value) {
  return String(value ?? "").replace(/\r?\n$/, "");
}

/**
 * OS keychain adapter. `runner` is injectable so tests never invoke a real
 * keychain. Secrets are never logged. macOS `security` accepts the password
 * only as an argv value here; this is intentional and avoids a shell string.
 */
export function createKeychain({
  platform = process.platform,
  runner = nodeExecFileSync,
  exists = existsSync,
  path = process.env.PATH,
  access = accessSync,
} = {}) {
  const macSecurity = "/usr/bin/security";
  const linuxSecretTool = executableOnPath("secret-tool", path, access);
  const kind = platform === "darwin" && exists(macSecurity)
    ? "macos"
    : platform === "linux" && linuxSecretTool
      ? "linux"
      : "unsupported";

  function service(name) {
    return `employee001:${name}`;
  }

  return {
    kind,
    available: kind !== "unsupported",
    store(name, value) {
      if (!SECRET_NAMES.includes(name) || !value || kind === "unsupported") return false;
      try {
        if (kind === "macos") {
          runner(macSecurity, ["add-generic-password", "-U", "-a", ACCOUNT, "-s", service(name), "-w", value], { stdio: ["ignore", "ignore", "ignore"] });
        } else {
          runner(linuxSecretTool, ["store", `--label=Employee001 ${name}`, "service", ACCOUNT, "name", name], { input: value, stdio: ["pipe", "ignore", "ignore"] });
        }
        return true;
      } catch {
        return false;
      }
    },
    read(name) {
      if (!SECRET_NAMES.includes(name) || kind === "unsupported") return null;
      try {
        const output = kind === "macos"
          ? runner(macSecurity, ["find-generic-password", "-w", "-a", ACCOUNT, "-s", service(name)], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
          : runner(linuxSecretTool, ["lookup", "service", ACCOUNT, "name", name], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
        const value = outputWithoutFinalNewline(output);
        return value || null;
      } catch {
        return null;
      }
    },
  };
}

/** @param {{ read(name: string): string | null }} keychain */
export function resolveEnvPlaceholders(env, keychain = createKeychain()) {
  const resolved = { ...env };
  const missing = [];
  for (const name of SECRET_NAMES) {
    if (resolved[name] !== KEYCHAIN_PLACEHOLDER) continue;
    const value = keychain.read(name);
    if (value) resolved[name] = value;
    else {
      delete resolved[name];
      missing.push(name);
    }
  }
  return { env: resolved, missing };
}
