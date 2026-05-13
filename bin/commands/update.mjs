import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import semver from "semver";

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(HERE, "..", "..");

// Adjust when the repo is moved to a public org.
const RELEASES_URL =
  "https://api.github.com/repos/dolevhayut/Employee001/releases/latest";

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
  process.stdout.write(`Latest:  ${latest}${publishedAt ? ` (${publishedAt.slice(0, 10)})` : ""}\n\n`);

  if (semver.gt(latestClean, current)) {
    process.stdout.write("A newer version is available.\n\n");
    if (body) {
      process.stdout.write("Release notes:\n");
      for (const line of body.trim().split("\n").slice(0, 30)) {
        process.stdout.write(`  ${line}\n`);
      }
      process.stdout.write("\n");
    }
    process.stdout.write("To upgrade, run:\n  npx employee001@latest\n\n");
  } else {
    process.stdout.write("You're on the latest version.\n");
  }
}
