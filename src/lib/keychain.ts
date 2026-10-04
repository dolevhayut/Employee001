import "server-only";

import { accessSync, constants, existsSync } from "fs";
import { execFileSync } from "child_process";
import { delimiter, join } from "path";

export const SECRET_NAMES = ["ANTHROPIC_API_KEY", "COMPOSIO_API_KEY", "OPENAI_API_KEY", "ELEVENLABS_API_KEY", "EMPLOYEE001_TOKEN"] as const;
export const KEYCHAIN_PLACEHOLDER = "@keychain";

export type SecretName = (typeof SECRET_NAMES)[number];
const ACCOUNT = "employee001";

function secretToolOnPath(): string | null {
  for (const directory of String(process.env.PATH ?? "").split(delimiter)) {
    if (!directory) continue;
    const candidate = join(directory, "secret-tool");
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Continue searching PATH.
    }
  }
  return null;
}

function keychainKind(): "macos" | "linux" | "unsupported" {
  if (process.platform === "darwin" && existsSync("/usr/bin/security")) return "macos";
  if (process.platform === "linux" && secretToolOnPath()) return "linux";
  return "unsupported";
}

/** Stores a secret without logging it. macOS security receives it as argv, never through a shell string. */
export function storeKeychainSecret(name: SecretName, value: string): boolean {
  if (!value) return false;
  const kind = keychainKind();
  try {
    if (kind === "macos") {
      execFileSync("/usr/bin/security", ["add-generic-password", "-U", "-a", ACCOUNT, "-s", `employee001:${name}`, "-w", value], { stdio: ["ignore", "ignore", "ignore"] });
      return true;
    }
    if (kind === "linux") {
      const tool = secretToolOnPath();
      if (!tool) return false;
      execFileSync(tool, ["store", `--label=Employee001 ${name}`, "service", ACCOUNT, "name", name], { input: value, stdio: ["pipe", "ignore", "ignore"] });
      return true;
    }
  } catch {
    // The caller keeps the existing file value when secure storage is unavailable.
  }
  return false;
}

export function readKeychainSecret(name: SecretName): string | null {
  const kind = keychainKind();
  try {
    const output = kind === "macos"
      ? execFileSync("/usr/bin/security", ["find-generic-password", "-w", "-a", ACCOUNT, "-s", `employee001:${name}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
      : kind === "linux"
        ? execFileSync(secretToolOnPath()!, ["lookup", "service", ACCOUNT, "name", name], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
        : "";
    const value = output.replace(/\r?\n$/, "");
    return value || null;
  } catch {
    return null;
  }
}
