# Single-tenant Employee001 container. See docs/DEPLOY-CLOUD.md.
# Node 24 LTS matches the app. Storage is plain files under data/ (JSON, JSONL,
# Markdown): no database and no native modules, so no build toolchain is needed.

FROM node:24-bookworm-slim AS base
# NOTE: do NOT set NODE_ENV=production here — `npm ci` would then skip
# devDependencies (typescript, @tailwindcss/postcss, …) that `next build` needs.
# Production mode is set only in the final `run` stage below.

# ── deps ──
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ── build: produce the Next.js standalone server bundle ──
FROM base AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ── run: minimal image, server.js at /app so process.cwd()=/app → data at /app/data ──
FROM base AS run
WORKDIR /app
# Next.js standalone output (server.js at the standalone root). The post-build
# step already copies .next/static and public/ into it.
COPY --from=build /app/.next/standalone ./
# The Agent SDK finds its native Claude Code binary by a package name it
# computes at run time (@anthropic-ai/claude-agent-sdk-linux-<arch>), which
# the standalone file tracer can't follow, so twin runs had no binary here.
# Same versions as the build: this adds the platform package (and puts
# sandbox-runtime alongside; hardened mode still needs bubblewrap, socat and
# ripgrep, which this image doesn't install).
COPY --from=deps /app/node_modules/@anthropic-ai/ ./node_modules/@anthropic-ai/

# server.js reads HOSTNAME/PORT; the app's proxy.ts middleware reads EMPLOYEE001_BIND
# to enforce the token gate on a non-loopback bind. EMPLOYEE001_TOKEN comes from
# `fly secrets` at runtime — never bake it into the image.
ENV NODE_ENV=production \
    PORT=8080 \
    HOSTNAME=0.0.0.0 \
    EMPLOYEE001_BIND=0.0.0.0

EXPOSE 8080
VOLUME ["/app/data"]
CMD ["node", "server.js"]
