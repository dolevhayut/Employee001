import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import * as p from "@clack/prompts";
import { createKeychain, KEYCHAIN_PLACEHOLDER, SECRET_NAMES } from "../lib/keychain.mjs";

function parseEnv(text) {
  const out = {};
  for (const line of text.split("\n")) {
    const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    out[match[1]] = value;
  }
  return out;
}

function replaceValue(text, name, value) {
  const expression = new RegExp(`^\\s*${name}\\s*=.*$`, "m");
  return expression.test(text)
    ? text.replace(expression, `${name}=${value}`)
    : `${text}${text && !text.endsWith("\n") ? "\n" : ""}${name}=${value}\n`;
}

/** Injectable migration core; the CLI wrapper supplies Clack and the real OS keychain. */
/** @param {{ cwd?: string, keychain?: { available: boolean, store(name: string, value: string): boolean, read(name: string): string | null }, confirm?: typeof p.confirm, isCancel?: typeof p.isCancel }} options */
export async function migratePlaintextSecrets(options = {}) {
  const {
    cwd = process.cwd(),
    keychain = createKeychain(),
    confirm = p.confirm,
    isCancel = p.isCancel,
  } = options;
  const envPath = resolve(cwd, ".env");
  if (!existsSync(envPath)) return { status: "missing_env", migrated: [] };
  if (!keychain.available) return { status: "unsupported", migrated: [] };

  const original = readFileSync(envPath, "utf8");
  const env = parseEnv(original);
  const names = SECRET_NAMES.filter((name) => env[name] && env[name] !== KEYCHAIN_PLACEHOLDER);
  if (!names.length) return { status: "nothing_to_do", migrated: [] };

  const approved = await confirm({
    message: `Move ${names.length} secret${names.length === 1 ? "" : "s"} to your OS keychain and replace them in .env?`,
    initialValue: true,
  });
  if (isCancel(approved) || !approved) return { status: "cancelled", migrated: [] };

  const migrated = [];
  for (const name of names) {
    if (keychain.store(name, env[name]) && keychain.read(name) === env[name]) migrated.push(name);
  }
  if (!migrated.length) return { status: "store_failed", migrated };

  const backupPath = resolve(cwd, ".env.bak");
  if (!existsSync(backupPath)) writeFileSync(backupPath, original, { mode: 0o600 });
  chmodSync(backupPath, 0o600);
  let updated = original;
  for (const name of migrated) updated = replaceValue(updated, name, KEYCHAIN_PLACEHOLDER);
  writeFileSync(envPath, updated, { mode: 0o600 });
  return { status: "migrated", migrated };
}

export default async function secure() {
  const result = await migratePlaintextSecrets();
  if (result.status === "missing_env") p.cancel("No .env found. Run `employee001 setup` first.");
  else if (result.status === "unsupported") p.cancel("OS keychain support is unavailable; secrets remain in .env.");
  else if (result.status === "nothing_to_do") p.outro("No plaintext secrets found in .env.");
  else if (result.status === "cancelled") p.cancel("Secure cancelled. .env left unchanged.");
  else if (result.status === "migrated") p.outro(`Moved ${result.migrated.join(", ")} to the OS keychain. Kept .env.bak for one run.`);
  else p.cancel("No secrets could be stored; .env left unchanged.");
}
