#!/usr/bin/env node
// Docker smoke: the image, run the way a server runs it, keeps what an admin
// set up across an update. The release gate installs the npm tarball, where
// the app folder is permanent; in the container only the /app/data volume is.
// Keys saved in Settings lived outside it and every rebuild dropped them,
// found on a client's server, not here (fixed in 0.15.1).
//
// Builds the image, runs it on a fresh volume behind the bootstrap token,
// creates the first owner, saves a key in Settings, then replaces the
// container with a new one on the same volume and checks the key, the owner
// account and the session are all still there. No model and no real keys.
//
// Usage: node scripts/docker-smoke.mjs [--image <tag>] [--no-build] [--keep]

import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function docker(args, { allowFail = false, timeout = 30 * 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile("docker", args, { cwd: ROOT, timeout, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err && !allowFail) reject(new Error(`docker ${args[0]} failed: ${(stderr || err.message).trim().split("\n").slice(-5).join("\n")}`));
      else resolve({ ok: !err, stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

export async function dockerAvailable() {
  return (await docker(["version", "--format", "{{.Server.Version}}"], { allowFail: true, timeout: 20_000 })).ok;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

/** A tiny cookie jar: name=value pairs from Set-Cookie, sent back as Cookie. */
function jar() {
  const cookies = new Map();
  return {
    take(res) {
      for (const line of res.headers.getSetCookie?.() ?? []) {
        const [pair] = line.split(";");
        const i = pair.indexOf("=");
        if (i > 0) {
          const value = pair.slice(i + 1);
          if (value) cookies.set(pair.slice(0, i), value);
          else cookies.delete(pair.slice(0, i));
        }
      }
    },
    header: () => [...cookies].map(([k, v]) => `${k}=${v}`).join("; "),
  };
}

async function waitUp(baseUrl, ms = 90_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      const res = await fetch(`${baseUrl}/api/auth/me`, { redirect: "manual" });
      if (res.status < 500) return;
    } catch {
      // not listening yet
    }
    await sleep(1000);
  }
  throw new Error(`the container did not answer at ${baseUrl} within ${ms / 1000}s`);
}

/** Run the smoke. Resolves with [{ name, result }] or rejects at the first failure. */
export async function dockerSmoke({ image = "employee001:smoke", build = true, keep = false, log = () => {} } = {}) {
  const id = randomBytes(4).toString("hex");
  const volume = `e001-smoke-${id}`;
  const name = `e001-smoke-${id}`;
  const token = randomBytes(24).toString("hex");
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const steps = [];
  const done = (step, result) => { steps.push({ name: step, result }); log(`${step}: ${result}`); };

  const run = () => docker([
    "run", "-d", "--name", name, "-p", `127.0.0.1:${port}:8080`,
    "-v", `${volume}:/app/data`, "-e", `EMPLOYEE001_TOKEN=${token}`, image,
  ]);

  try {
    if (build) {
      const started = Date.now();
      await docker(["build", "-t", image, "."]);
      done("build", `PASS (${Math.round((Date.now() - started) / 1000)}s)`);
    }
    await docker(["volume", "create", volume]);
    await run();
    await waitUp(baseUrl);
    done("start", "PASS");

    // The image must keep both kinds of state on the volume.
    const env = (await docker(["exec", name, "printenv", "EMPLOYEE001_ENV_FILE", "CLAUDE_CONFIG_DIR"])).stdout.split("\n");
    if (env[0] !== "/app/data/.env" || env[1] !== "/app/data/.claude") throw new Error(`image env points outside the volume: ${env.join(", ")}`);
    done("state on the volume", "PASS (EMPLOYEE001_ENV_FILE, CLAUDE_CONFIG_DIR)");

    // First owner, the way a client opens the access link.
    // Follow the redirects by hand (/ -> /welcome?token -> /auth/setup) so
    // the bootstrap cookie set on the way is kept, as a browser would.
    const cookies = jar();
    let next = `${baseUrl}/?token=${token}`;
    for (let hop = 0; next && hop < 5; hop++) {
      const res = await fetch(next, { redirect: "manual", headers: { cookie: cookies.header() } });
      cookies.take(res);
      const location = res.headers.get("location");
      next = location ? new URL(location, next).toString() : null;
      if (next?.includes("/auth/setup")) break;
    }
    const email = `owner-${id}@smoke.test`;
    const password = randomBytes(18).toString("base64url");
    const setup = await fetch(`${baseUrl}/api/auth/setup`, {
      method: "POST", headers: { "content-type": "application/json", cookie: cookies.header() },
      body: JSON.stringify({ email, name: "Smoke Owner", password }),
    });
    cookies.take(setup);
    if (!setup.ok) throw new Error(`owner setup returned ${setup.status}: ${await setup.text()}`);
    done("owner setup", "PASS");

    // An admin saves a key in Settings. A dummy value: nothing calls Composio.
    const save = await fetch(`${baseUrl}/api/system/config`, {
      method: "PATCH", headers: { "content-type": "application/json", cookie: cookies.header() },
      body: JSON.stringify({ key: "COMPOSIO_API_KEY", value: `smoke-${id}` }),
    });
    if (!save.ok) throw new Error(`saving a key in Settings returned ${save.status}: ${await save.text()}`);
    const mode = (await docker(["exec", name, "stat", "-c", "%a", "/app/data/.env"])).stdout;
    if (mode !== "600") throw new Error(`/app/data/.env is mode ${mode}, expected 600`);
    done("key saved in Settings", "PASS (/app/data/.env, mode 600)");

    // The update: a new container from the image, same volume.
    await docker(["rm", "-f", name]);
    await run();
    await waitUp(baseUrl);

    const config = await fetch(`${baseUrl}/api/system/config`, { headers: { cookie: cookies.header() } });
    if (config.status !== 200) throw new Error(`after recreate the old session got ${config.status} (session or accounts lost)`);
    if ((await config.json()).composio !== true) throw new Error("after recreate the key saved in Settings is gone");
    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }),
    });
    if (!login.ok) throw new Error(`after recreate the owner can't sign in (${login.status})`);
    done("after recreate", "PASS (session, owner account and saved key kept)");
    return steps;
  } finally {
    if (!keep) {
      await docker(["rm", "-f", name], { allowFail: true });
      await docker(["volume", "rm", "-f", volume], { allowFail: true });
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (flag) => { const i = process.argv.indexOf(flag); return i > 0 ? process.argv[i + 1] : undefined; };
  dockerSmoke({
    image: arg("--image") ?? "employee001:smoke",
    build: !process.argv.includes("--no-build"),
    keep: process.argv.includes("--keep"),
    log: (line) => console.log(line),
  }).then(
    () => console.log("Docker smoke: PASS"),
    (err) => { console.error(`Docker smoke: FAIL: ${err.message}`); process.exit(1); },
  );
}
