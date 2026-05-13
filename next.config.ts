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
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "cdn.simpleicons.org" },
    ],
  },
};

export default nextConfig;
