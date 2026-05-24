#!/usr/bin/env node
// Runs after `next build` to make .next/standalone self-contained.
//
// Next.js produces three pieces:
//   .next/standalone/  — server.js + minimal node_modules
//   .next/static/      — client-side hashed assets
//   public/            — static public files
//
// `next start` (when not standalone) would serve static + public automatically.
// The standalone server.js does NOT — Next.js documents that you must copy
// `public/` and `.next/static/` into the standalone tree yourself.
//
// This script does that copy idempotently so the npm tarball ships a tree
// that boots with `node .next/standalone/server.js`.

import { cpSync, existsSync, mkdirSync, rmSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const STANDALONE = join(ROOT, ".next", "standalone");

if (!existsSync(STANDALONE)) {
  console.error(
    "[post-build] .next/standalone is missing. Did you set `output: 'standalone'` in next.config.ts?",
  );
  process.exit(1);
}

// SECURITY: Belt-and-suspenders cleanup of any sensitive paths that might
// have slipped into the standalone bundle despite outputFileTracingExcludes.
// The 0.1.0 publish on 2026-05-24 shipped the dev machine's full data/ tree
// (Apify/Firecrawl/Higgsfield tokens, Composio account bindings, twin memory,
// 8 days of audit log). This block ensures that even if the tracer config
// regresses, the published tarball is clean.
const FORBIDDEN = [
  join(STANDALONE, "data"),
  join(STANDALONE, ".env"),
  join(STANDALONE, ".env.local"),
  join(STANDALONE, ".env.development"),
  join(STANDALONE, ".env.production"),
];
for (const p of FORBIDDEN) {
  if (existsSync(p)) {
    const isDir = statSync(p).isDirectory();
    rmSync(p, { recursive: true, force: true });
    console.warn(`[post-build] ⚠️  removed ${isDir ? "directory" : "file"} ${p} from standalone bundle — must never ship`);
  }
}

// SECURITY: Final assertion — re-scan the standalone tree and abort the
// build if anything resembling data/* or .env* survived. This makes the
// build fail loudly rather than silently producing a leaky tarball.
function findForbidden(dir, relRoot = "") {
  const hits = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = join(relRoot, entry.name);
    const full = join(dir, entry.name);
    if (entry.name === "data" || /^\.env(\.|$)/.test(entry.name)) {
      hits.push(rel);
      continue;
    }
    if (entry.isDirectory()) hits.push(...findForbidden(full, rel));
  }
  return hits;
}
const surviving = findForbidden(STANDALONE);
if (surviving.length > 0) {
  console.error("[post-build] 🛑 FORBIDDEN paths found in standalone bundle:");
  for (const h of surviving) console.error(`  - .next/standalone/${h}`);
  console.error("[post-build] aborting build — fix outputFileTracingExcludes in next.config.ts");
  process.exit(2);
}

const STATIC_SRC = join(ROOT, ".next", "static");
const STATIC_DEST = join(STANDALONE, ".next", "static");
if (existsSync(STATIC_SRC)) {
  mkdirSync(dirname(STATIC_DEST), { recursive: true });
  cpSync(STATIC_SRC, STATIC_DEST, { recursive: true });
  console.log(`[post-build] copied .next/static → standalone/.next/static`);
} else {
  console.warn("[post-build] .next/static missing — skipping");
}

const PUBLIC_SRC = join(ROOT, "public");
const PUBLIC_DEST = join(STANDALONE, "public");
if (existsSync(PUBLIC_SRC)) {
  cpSync(PUBLIC_SRC, PUBLIC_DEST, { recursive: true });
  console.log(`[post-build] copied public → standalone/public`);
} else {
  console.warn("[post-build] public/ missing — skipping");
}

console.log("[post-build] done.");
