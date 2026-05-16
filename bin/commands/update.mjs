import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { execSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import semver from "semver";

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(HERE, "..", "..");

const RELEASES_URL =
  "https://api.github.com/repos/dolevhayut/Employee001/releases/latest";

function prompt(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

export default async function update() {
  const pkg = JSON.parse(readFileSync(join(PKG_ROOT, "package.json"), "utf8"));
  const currentRaw = pkg.version;
  const current = semver.valid(currentRaw) ?? "0.0.0";

  process.stdout.write(`\nCurrent: ${currentRaw}\n`);

  let latest, body, publishedAt;
  try {
    const res = await fetch(RELEASES_URL, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!res.ok) {
      if (res.status === 404) {
        process.stdout.write(
          "No releases published yet. Watch the repo to be notified:\n  https://github.com/dolevhayut/Employee001\n",
        );
        return;
      }
      throw new Error(`GitHub API returned ${res.status}`);
    }
    const data = await res.json();
    latest = (data.tag_name ?? "").replace(/^v/, "");
    body = data.body ?? "";
    publishedAt = data.published_at ?? "";
  } catch (err) {
    process.stdout.write(`Could not check for updates: ${err.message}\n`);
    return;
  }

  const latestClean = semver.valid(latest) ?? "0.0.0";
  process.stdout.write(
    `Latest:  ${latest}${publishedAt ? ` (${publishedAt.slice(0, 10)})` : ""}\n\n`,
  );

  if (!semver.gt(latestClean, current)) {
    process.stdout.write("You're on the latest version.\n");
    return;
  }

  process.stdout.write(`A newer version is available: ${latest}\n\n`);

  if (body) {
    process.stdout.write("Release notes:\n");
    for (const line of body.trim().split("\n").slice(0, 20)) {
      process.stdout.write(`  ${line}\n`);
    }
    process.stdout.write("\n");
  }

  // Detect whether the user installed globally or is running via npx.
  // npm sets npm_config_global=true for global installs.
  const isGlobal = process.env.npm_config_global === "true";
  const upgradeCmd = isGlobal
    ? `npm install -g employee001@${latest}`
    : `npx employee001@${latest}`;

  if (isGlobal) {
    const answer = await prompt(`Update to ${latest} now? [Y/n] `);
    if (answer === "" || answer.toLowerCase() === "y") {
      process.stdout.write(`\nRunning: ${upgradeCmd}\n\n`);
      try {
        execSync(upgradeCmd, { stdio: "inherit" });
        process.stdout.write(`\nUpdated to ${latest}. Restart the server to apply.\n`);
      } catch {
        process.stdout.write(
          `\nUpdate failed. Try manually:\n  ${upgradeCmd}\n`,
        );
        process.exitCode = 1;
      }
    } else {
      process.stdout.write(`Skipped. To update manually:\n  ${upgradeCmd}\n`);
    }
  } else {
    // Running via npx — npx always fetches the version it was invoked with,
    // so we just tell the user to run the new version directly.
    process.stdout.write(`To upgrade, run:\n  ${upgradeCmd}\n\n`);
  }
}
