import { existsSync, readdirSync, statSync, mkdirSync, readFileSync, accessSync, constants } from "node:fs";
import { resolve, join } from "node:path";
import * as tar from "tar";

const COLOR = process.stdout.isTTY
  ? { red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m", reset: "\x1b[0m", dim: "\x1b[2m" }
  : { red: "", green: "", yellow: "", reset: "", dim: "" };

function isNonEmptyDir(p) {
  try {
    return statSync(p).isDirectory() && readdirSync(p).length > 0;
  } catch {
    return false;
  }
}

export default async function importCmd(args) {
  const cwd = process.cwd();
  const positional = args.filter((a) => !a.startsWith("-"));
  const flags = new Set(args.filter((a) => a.startsWith("-")));
  const force = flags.has("--force") || flags.has("-f");

  if (positional.length === 0) {
    process.stderr.write(`${COLOR.red}error:${COLOR.reset} usage: employee001 import <archive> [--force]\n`);
    process.exitCode = 1;
    return;
  }

  const archive = resolve(cwd, positional[0]);

  if (!existsSync(archive)) {
    process.stderr.write(`${COLOR.red}error:${COLOR.reset} archive not found: ${archive}\n`);
    process.exitCode = 1;
    return;
  }
  try {
    accessSync(archive, constants.R_OK);
  } catch {
    process.stderr.write(`${COLOR.red}error:${COLOR.reset} archive is not readable: ${archive}\n`);
    process.exitCode = 1;
    return;
  }

  const dataDir = resolve(cwd, "data");
  if (isNonEmptyDir(dataDir) && !force) {
    process.stderr.write(
      `${COLOR.red}error:${COLOR.reset} ${dataDir} already exists and is not empty.\n` +
        `       Re-run with --force to overwrite, or move data/ aside first.\n`,
    );
    process.exitCode = 1;
    return;
  }

  process.stdout.write(`\nEmployee001 — import\n\n`);
  process.stdout.write(`  archive:  ${archive}\n`);
  process.stdout.write(`  target:   ${cwd}\n`);
  if (force && isNonEmptyDir(dataDir)) {
    process.stdout.write(`  ${COLOR.yellow}!${COLOR.reset} --force: existing data/ contents will be overlaid\n`);
  }

  // Make sure cwd exists (it does — it's cwd) — extract into it.
  mkdirSync(cwd, { recursive: true });

  try {
    await tar.extract({
      file: archive,
      cwd,
    });
  } catch (err) {
    process.stderr.write(`${COLOR.red}error:${COLOR.reset} extraction failed: ${err.message}\n`);
    process.exitCode = 1;
    return;
  }

  // Read manifest if present.
  const manifestPath = join(cwd, "manifest.json");
  let manifest = null;
  if (existsSync(manifestPath)) {
    try {
      manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    } catch {
      /* ignore */
    }
  }

  // Count employees post-extract.
  const empDir = join(dataDir, "employees");
  let count = 0;
  if (existsSync(empDir)) {
    count = readdirSync(empDir, { withFileTypes: true }).filter((d) => d.isDirectory()).length;
  }

  process.stdout.write(`\n  ${COLOR.green}✓${COLOR.reset} restored ${count} employee${count === 1 ? "" : "s"}\n`);
  if (manifest) {
    process.stdout.write(
      `  ${COLOR.dim}exported ${manifest.exportedAt} • employees in manifest: ${manifest.employeeCount} • package ${manifest.packageVersion}${COLOR.reset}\n`,
    );
  }
  process.stdout.write(`\n  Next: copy a .env (see .env.example) and run \`employee001 doctor\`.\n\n`);
}
