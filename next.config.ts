import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Produces .next/standalone — a self-contained server bundle.
  // The npm tarball ships this so `npx employee001 start` can boot
  // without needing the source tree or node_modules.
  output: "standalone",
  // Pin the file-tracing root so standalone output lands at
  // .next/standalone/server.js rather than nested under the absolute
  // project path (Next.js default behavior when project is in a deep dir).
  outputFileTracingRoot: path.join(__dirname),
  // The runtime reads from data/ via `fs` in src/lib/employees-disk.ts,
  // src/lib/audit-log.ts, etc. Without this exclusion, Next.js' file tracer
  // sees those reads at build time and copies the entire current data/ tree
  // into .next/standalone/data/ — including the dev machine's secrets,
  // tokens, twin memory, audit log, and Composio connection state. That tree
  // would then ship in the npm tarball (caused the 0.1.0 leak on 2026-05-24).
  // Excluding data/** here keeps fs reads working at runtime (they resolve
  // against the user's cwd) while preventing build-time inclusion of dev data.
  outputFileTracingExcludes: {
    "*": ["data/**", "**/data/**", ".env*", "**/.env*"],
  },
  // Next 16 blocks cross-origin requests to dev resources by default. When
  // the browser hits the dev server via 127.0.0.1 (instead of the literal
  // host Next sees), the HMR client chunks are rejected — which on this
  // codebase silently breaks client-side hydration across the whole
  // workspace. Allow both loopback names so dev works regardless of which
  // the user types.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "cdn.simpleicons.org" },
    ],
  },
};

export default nextConfig;
