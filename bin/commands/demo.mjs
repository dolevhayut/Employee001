import { cpSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { launchServer } from "./start.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(HERE, "..", "..");
const DEFAULT_PORT = 3100;

/** Parse the intentionally small public demo CLI surface without spawning a server. */
export function parseDemoArgs(argv) {
  let port = DEFAULT_PORT;
  let noOpen = false;
  let keep = false;
  let live = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--no-open") noOpen = true;
    else if (arg === "--keep") keep = true;
    else if (arg === "--live") live = true;
    else if (arg === "--port") {
      const value = argv[++index];
      if (!value || !/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535) {
        throw new Error("--port must be a number from 1 to 65535");
      }
      port = Number(value);
    } else {
      throw new Error(`Unknown demo option: ${arg}`);
    }
  }

  return { port, noOpen, keep, live };
}

const BASE_ENV_KEYS = new Set(["PATH", "HOME", "USER", "TMPDIR", "LANG", "TZ", "NODE_OPTIONS"]);

function isLiveProviderKey(key) {
  return (
    key === "CLOUD_ML_REGION" ||
    key === "GOOGLE_APPLICATION_CREDENTIALS" ||
    key === "EMPLOYEE001_MODEL_PROVIDER" ||
    key === "EMPLOYEE001_ALLOW_DIRECT_ANTHROPIC" ||
    key.startsWith("ANTHROPIC_") ||
    key.startsWith("AWS_") ||
    key.startsWith("AZURE_") ||
    key.startsWith("GOOGLE_")
  );
}

/**
 * The demo child has a deliberately tiny inherited environment. In particular,
 * a shell-exported API key cannot turn a replay into a billable run.
 * @param {{ home: string, port: number, live?: boolean, parentEnv?: Record<string, string | undefined>, recordingPath: string }} options
 */
export function buildDemoChildEnv({ home, port, live = false, parentEnv = process.env, recordingPath }) {
  const childEnv = {};
  for (const [key, value] of Object.entries(parentEnv)) {
    if (value === undefined) continue;
    if (BASE_ENV_KEYS.has(key) || key.startsWith("LC_")) childEnv[key] = value;
    if (live && isLiveProviderKey(key)) childEnv[key] = value;
  }

  return {
    ...childEnv,
    EMPLOYEE001_HOME: resolve(home),
    EMPLOYEE001_DEMO: "1",
    ...(live ? { EMPLOYEE001_DEMO_LIVE: "1" } : {}),
    EMPLOYEE001_BIND: "127.0.0.1",
    EMPLOYEE001_DEMO_RECORDING: resolve(recordingPath),
    PORT: String(port),
  };
}

export function createDemoHome({ pkgRoot = PKG_ROOT, port = DEFAULT_PORT }) {
  const fixture = join(pkgRoot, "bin", "demo", "data");
  if (!existsSync(fixture)) throw new Error("Demo fixture is missing from this Employee001 install.");

  const home = mkdtempSync(join(tmpdir(), "employee001-demo-"));
  cpSync(fixture, join(home, "data"), { recursive: true });
  writeFileSync(
    join(home, ".env"),
    [
      `PORT=${port}`,
      "EMPLOYEE001_DEMO=1",
      "EMPLOYEE001_BIND=127.0.0.1",
      "",
    ].join("\n"),
    { mode: 0o600 },
  );
  return home;
}

export default async function demo(argv) {
  const options = parseDemoArgs(argv);
  const home = createDemoHome({ port: options.port });
  const recordingPath = join(PKG_ROOT, "bin", "demo", "recording.json");
  const env = buildDemoChildEnv({ home, port: options.port, live: options.live, recordingPath });
  let cleaned = false;
  const cleanup = () => {
    if (cleaned || options.keep) return;
    cleaned = true;
    rmSync(home, { recursive: true, force: true });
  };

  const child = launchServer({
    home,
    port: options.port,
    bind: "127.0.0.1",
    env,
    open: "/council",
    noOpen: options.noOpen,
    inheritEnv: false,
  });

  if (!child) {
    cleanup();
    return;
  }

  child.once("exit", () => {
    cleanup();
    if (options.keep) process.stdout.write(`Demo data kept at ${home}\n`);
  });
  const cleanAfterChildExits = () => child.once("exit", cleanup);
  process.once("SIGINT", cleanAfterChildExits);
  process.once("SIGTERM", cleanAfterChildExits);

  process.stdout.write(
    `Demo running at http://localhost:${options.port} — 5 invented twins at Lumen Labs. Nothing here touches your files. Ctrl+C to stop.\n`,
  );
}
