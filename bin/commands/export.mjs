import { existsSync, readdirSync, statSync, writeFileSync, mkdirSync, rmSync, createReadStream, createWriteStream, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { createGzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import * as tar from "tar";
import * as p from "@clack/prompts";
import { encryptArchive } from "../lib/encrypted-archive.mjs";

const COLOR = process.stdout.isTTY
  ? { red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m", reset: "\x1b[0m", dim: "\x1b[2m" }
  : { red: "", green: "", yellow: "", reset: "", dim: "" };

function ts() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function humanSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(1)} ${units[i]}`;
}

function countEmployees(dataDir) {
  const emp = join(dataDir, "employees");
  if (!existsSync(emp)) return 0;
  try {
    return readdirSync(emp, { withFileTypes: true }).filter((d) => d.isDirectory()).length;
  } catch {
    return 0;
  }
}

function readPkgVersion() {
  try {
    const pkgPath = resolve(new URL("../../package.json", import.meta.url).pathname);
    return JSON.parse(readFileSync(pkgPath, "utf8")).version;
  } catch {
    return "unknown";
  }
}

export default async function exportCmd(args) {
  const cwd = process.cwd();
  const home = process.env.EMPLOYEE001_HOME ? resolve(process.env.EMPLOYEE001_HOME) : cwd;
  const dataDir = resolve(home, "data");

  if (!existsSync(dataDir)) {
    process.stderr.write(`${COLOR.red}error:${COLOR.reset} no data/ directory found in ${home}\n`);
    process.exitCode = 1;
    return;
  }

  const positional = args.filter((a) => !a.startsWith("-"));
  const encrypt = args.includes("--encrypt");
  const archiveTarget = positional[0]
    ? resolve(cwd, positional[0])
    : resolve(cwd, `e001-backup-${ts()}.tar.gz`);
  const target = !encrypt
    ? archiveTarget
    : archiveTarget.endsWith(".tar.gz.enc")
      ? archiveTarget
      : archiveTarget.endsWith(".tar.gz")
        ? `${archiveTarget}.enc`
        : `${archiveTarget}.tar.gz.enc`;

  let passphrase = process.env.EMPLOYEE001_EXPORT_PASSPHRASE;
  if (encrypt && !passphrase) {
    passphrase = await p.password({
      message: "Archive passphrase (at least 12 characters)",
      mask: "•",
      validate: (value) => value.length >= 12 ? undefined : "Passphrase must be at least 12 characters",
    });
    if (p.isCancel(passphrase)) {
      p.cancel("Export cancelled");
      return;
    }
    const confirmation = await p.password({ message: "Confirm archive passphrase", mask: "•" });
    if (p.isCancel(confirmation)) {
      p.cancel("Export cancelled");
      return;
    }
    if (passphrase !== confirmation) {
      process.stderr.write(`${COLOR.red}error:${COLOR.reset} passphrases do not match\n`);
      process.exitCode = 1;
      return;
    }
  }
  if (encrypt && (!passphrase || passphrase.length < 12)) {
    process.stderr.write(`${COLOR.red}error:${COLOR.reset} export passphrase must be at least 12 characters\n`);
    process.exitCode = 1;
    return;
  }

  const manifest = {
    version: 1,
    exportedAt: new Date().toISOString(),
    nodeVersion: process.version,
    packageVersion: readPkgVersion(),
    employeeCount: countEmployees(dataDir),
  };

  // Stage manifest in a temp dir.
  const stage = resolve(tmpdir(), `e001-export-${Date.now()}`);
  mkdirSync(stage, { recursive: true });
  writeFileSync(join(stage, "manifest.json"), JSON.stringify(manifest, null, 2));

  process.stdout.write(`\nEmployee001 — export\n\n`);
  process.stdout.write(`  source:   ${dataDir}\n`);
  process.stdout.write(`  target:   ${target}\n`);
  process.stdout.write(`  employees: ${manifest.employeeCount}\n`);

  // Build uncompressed tar first (so we can append manifest), then gzip in a pipeline.
  const tmpTar = resolve(tmpdir(), `e001-export-${Date.now()}.tar`);

  try {
    // Pack data/ relative to the configured Employee001 home.
    await tar.create(
      {
        file: tmpTar,
        cwd: home,
        portable: true,
        filter: (path) => {
          const base = path.split("/").pop() || "";
          if (base === ".env" || base.startsWith(".env.")) return false;
          return true;
        },
      },
      ["data"]
    );

    // Append manifest.json (uncompressed tar supports update).
    await tar.update(
      {
        file: tmpTar,
        cwd: stage,
      },
      ["manifest.json"]
    );

    // Gzip the tar into the final target.
    if (encrypt) {
      const compressedArchive = resolve(tmpdir(), `e001-export-${Date.now()}-${process.pid}.tar.gz`);
      try {
        await pipeline(createReadStream(tmpTar), createGzip(), createWriteStream(compressedArchive));
        await encryptArchive(compressedArchive, target, passphrase);
      } finally {
        rmSync(compressedArchive, { force: true });
      }
    } else {
      await pipeline(createReadStream(tmpTar), createGzip(), createWriteStream(target));
    }
  } catch (err) {
    process.stderr.write(`${COLOR.red}error:${COLOR.reset} failed to create archive: ${err.message}\n`);
    process.exitCode = 1;
    return;
  } finally {
    rmSync(stage, { recursive: true, force: true });
    rmSync(tmpTar, { force: true });
  }

  const size = statSync(target).size;
  process.stdout.write(`\n  ${COLOR.green}✓${COLOR.reset} wrote ${humanSize(size)} → ${target}\n`);
  process.stdout.write(`  ${COLOR.dim}(.env and .env.* excluded)${COLOR.reset}\n\n`);
}
