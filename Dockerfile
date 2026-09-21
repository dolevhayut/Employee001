# Single-tenant Employee001 container. See docs/DEPLOY-CLOUD.md.
# Node 24 matches the app and avoids the better-sqlite3 native-build gap on newer Node.

FROM node:24-bookworm-slim AS base
# NOTE: do NOT set NODE_ENV=production here — `npm ci` would then skip
# devDependencies (typescript, @tailwindcss/postcss, …) that `next build` needs.
# Production mode is set only in the final `run` stage below.

# ── deps: install with a toolchain so better-sqlite3 can build if no prebuilt matches ──
FROM base AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
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
# Next.js standalone output (server.js at the standalone root).
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
# Ensure the native SQLite binary is present (traced by standalone, copied explicitly to be safe).
COPY --from=build /app/node_modules/better-sqlite3 ./node_modules/better-sqlite3

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
