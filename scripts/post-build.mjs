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

import { cpSync, existsSync, mkdirSync } from "node:fs";
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
