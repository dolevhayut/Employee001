#!/usr/bin/env node
/**
 * scripts/sync-public.mjs
 *
 * Build a clean public mirror of this repo at `../Employee001-public/`.
 *
 * Why:
 *   This dev repo carries demo data, real API keys in .env.local, internal
 *   session logs (docs/BUILD-*.md, docs/PROGRESS.md), claude/cursor configs,
 *   and 39MB of fake-employee markdown profiles. None of that should ship
 *   to npm or appear in the public GitHub repo where customers / curious
 *   visitors might browse the history.
 *
 *   Rather than scrubbing git history, we maintain a separate public repo
 *   with a fresh `git init`. Each release: re-run this script, commit, push.
 *
 * Usage:
 *   node scripts/sync-public.mjs              # default: ../Employee001-public/
 *   node scripts/sync-public.mjs --to <path>  # custom target
 *   node scripts/sync-public.mjs --force      # delete existing target first
 *   node scripts/sync-public.mjs --dry        # list files that would be copied
 *
 * After running:
 *   cd ../Employee001-public
 *   git remote add origin git@github.com:dolevhayut/employee001.git  # one time
 *   git add . && git commit -m "v0.1.0" && git push -u origin main
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, cpSync, rmSync, statSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, "..");

const argv = process.argv.slice(2);
const dry = argv.includes("--dry");
const force = argv.includes("--force");
const toIdx = argv.indexOf("--to");
const targetArg = toIdx >= 0 ? argv[toIdx + 1] : null;
const TARGET = targetArg
  ? resolve(targetArg)
  : resolve(SRC, "..", "Employee001-public");

// ---- Allowlist: only these top-level paths are copied ----
// Anything else in SRC is implicitly EXCLUDED. This is intentional —
// allowlists fail safe. If you add a new top-level item that should ship,
// add it here.
const ALLOW = [
  "src",
  "bin",
  "public",
  "scripts/post-build.mjs",
  "scripts/sync-public.mjs", // include this script so the public repo can sync forward (not that it would, but for transparency)
  "package.json",
  "package-lock.json",
  "next.config.ts",
  "next-env.d.ts",
  "tsconfig.json",
  "eslint.config.mjs",
  "postcss.config.mjs",
  "README.md",
  "LICENSE",
  ".env.example",
  ".npmignore",
];

// ---- Deny patterns inside otherwise-allowed dirs ----
// e.g. `public/` is allowed but `public/remotion/` is internal video artifacts.
function denyInside(absPath) {
  const rel = relative(SRC, absPath);
  if (rel.includes(".DS_Store")) return true;
  if (rel.startsWith("public/remotion")) return true;
  if (rel.includes("/.claude/")) return true;
  if (rel.includes("/.cursor/")) return true;
  if (rel.includes("/.codex/")) return true;
  if (rel.includes("/.agents/")) return true;
  if (rel.includes("/.windsurf/")) return true;
  // src files that ship test fixtures or internal-only helpers:
  if (rel.endsWith("/seed-task.ts")) return true;
  return false;
}

// ---- Public-facing .gitignore (replaces the dev one) ----
const PUBLIC_GITIGNORE = `# Dependencies & build
node_modules/
.next/
out/
*.tsbuildinfo

# Local config & secrets
.env
.env.local
.env.development
.env.production

# Local data (created on first run)
data/

# OS
.DS_Store
Thumbs.db

# Editor scratch
*.swp
.vscode/
.idea/
`;

// ---- package.json rewrite for the public mirror ----
function adjustPackageJson(text) {
  const pkg = JSON.parse(text);
  // Already named "employee001" in dev — keep as is.
  // Strip any dev-only scripts that reference internal paths.
  const safeScripts = {
    dev: pkg.scripts.dev,
    build: pkg.scripts.build,
    start: pkg.scripts.start,
    lint: pkg.scripts.lint,
    "pack:dry": pkg.scripts["pack:dry"],
    prepack: pkg.scripts.prepack,
  };
  // remove remotion + eval scripts that reference internal evals/social paths
  for (const k of Object.keys(safeScripts)) {
    if (safeScripts[k] === undefined) delete safeScripts[k];
  }
  pkg.scripts = safeScripts;
  return JSON.stringify(pkg, null, 2) + "\n";
}

// ---- Run ----
function copyTreeOrFile(srcPath, destPath) {
  const st = statSync(srcPath);
  if (st.isDirectory()) {
    cpSync(srcPath, destPath, {
      recursive: true,
      filter: (s) => !denyInside(s),
      preserveTimestamps: true,
    });
  } else {
    if (denyInside(srcPath)) return;
    mkdirSync(dirname(destPath), { recursive: true });
    cpSync(srcPath, destPath, { preserveTimestamps: true });
  }
}

function listAllFiles(absPath, out = []) {
  const st = statSync(absPath);
  if (st.isDirectory()) {
    for (const e of execSync(`find "${absPath}" -type f`, { encoding: "utf8" }).split("\n")) {
      if (!e || denyInside(e)) continue;
      out.push(e);
    }
  } else if (!denyInside(absPath)) {
    out.push(absPath);
  }
  return out;
}

async function main() {
  console.log(`source : ${SRC}`);
  console.log(`target : ${TARGET}`);
  console.log(`mode   : ${dry ? "DRY RUN" : "COPY"}\n`);

  if (existsSync(TARGET)) {
    if (force) {
      console.log(`[force] removing existing ${TARGET}`);
      if (!dry) rmSync(TARGET, { recursive: true, force: true });
    } else {
      console.error(
        `Target ${TARGET} already exists. Re-run with --force to overwrite (this will delete the existing directory).`,
      );
      process.exit(1);
    }
  }

  if (!dry) mkdirSync(TARGET, { recursive: true });

  let fileCount = 0;
  let totalBytes = 0;

  for (const item of ALLOW) {
    const srcPath = join(SRC, item);
    if (!existsSync(srcPath)) {
      console.warn(`[skip] ${item} (not found in source)`);
      continue;
    }
    const destPath = join(TARGET, item);
    if (dry) {
      const files = listAllFiles(srcPath);
      for (const f of files) {
        const bytes = statSync(f).size;
        totalBytes += bytes;
        fileCount++;
        console.log(`  ${relative(SRC, f)}  (${bytes}b)`);
      }
    } else {
      copyTreeOrFile(srcPath, destPath);
      console.log(`  ${item}`);
    }
  }

  if (dry) {
    console.log(`\n${fileCount} files, ~${Math.round(totalBytes / 1024)}KB would be copied.`);
    return;
  }

  // Post-copy: rewrite package.json scripts & write fresh .gitignore
  const pkgPath = join(TARGET, "package.json");
  if (existsSync(pkgPath)) {
    writeFileSync(pkgPath, adjustPackageJson(readFileSync(pkgPath, "utf8")));
    console.log(`  [adjusted] package.json scripts trimmed`);
  }

  writeFileSync(join(TARGET, ".gitignore"), PUBLIC_GITIGNORE);
  console.log(`  [created] .gitignore (public-friendly)`);

  // Sanity: refuse to ship any file that contains a recognizable secret pattern.
  const SECRET_PATTERNS = [
    /sk-ant-[A-Za-z0-9_\-]{20,}/, // Anthropic API key
    /sk-proj-[A-Za-z0-9_\-]{20,}/, // OpenAI project key
    /xoxb-[A-Za-z0-9\-]+/, // Slack bot token
    /ghp_[A-Za-z0-9]{20,}/, // GitHub personal access token
    /eyJ[A-Za-z0-9_\-]{40,}\.[A-Za-z0-9_\-]{20,}\.[A-Za-z0-9_\-]+/, // JWT
  ];
  const allFiles = execSync(`find "${TARGET}" -type f`, { encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
  const violations = [];
  for (const f of allFiles) {
    const sz = statSync(f).size;
    if (sz > 5_000_000) continue; // skip huge binaries
    let text;
    try {
      text = readFileSync(f, "utf8");
    } catch {
      continue; // binary
    }
    for (const re of SECRET_PATTERNS) {
      if (re.test(text)) {
        violations.push({ file: relative(TARGET, f), pattern: re.source });
        break;
      }
    }
  }
  if (violations.length > 0) {
    console.error(`\n❌ SECRET DETECTED in target — aborting:\n`);
    for (const v of violations) console.error(`   ${v.file}  matches  ${v.pattern}`);
    console.error(`\nRemove the secret from source, then re-run.`);
    process.exit(2);
  }

  console.log(`\n✓ Public mirror written to ${TARGET}`);
  console.log(`  Files: ${allFiles.length}`);

  // Fresh git init
  if (existsSync(join(TARGET, ".git"))) {
    console.log(`  .git already exists — leaving history alone`);
  } else {
    execSync(`git init -q -b main`, { cwd: TARGET });
    console.log(`  git initialized (branch main)`);
  }

  console.log(`
Next steps:
  cd ${TARGET}
  git add .
  git commit -m "Initial public release v0.1.0"
  git remote add origin git@github.com:dolevhayut/employee001.git
  git push -u origin main
`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
