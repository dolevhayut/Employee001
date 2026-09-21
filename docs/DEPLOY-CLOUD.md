# Run your own cloud instance

> Deploy a **single-tenant** Employee001 to an always-on host so remote employees can
> reach their twins from anywhere — while the data stays **yours**, on infrastructure
> **you** control. This is "your own private cloud", not a multi-tenant SaaS.

This is the runbook behind the **Professional onboarding** service (we can do this
*for* an org), and a DIY guide for anyone who wants to self-host. No code in this repo
becomes a paid feature — this is all MIT.

---

## Why not just port-forward the local server?

The local app binds to `127.0.0.1`. Invite links are built from the URL the CEO's
browser is on — so an invite generated at `http://127.0.0.1:3000/join?invite=…` points
the *recipient's* machine at *its own* loopback, where nothing is running. That's why
invitations "don't work" once you leave the CEO's laptop. A shareable instance needs a
**stable, reachable URL** and a canonical base URL the app builds links from.

---

## The model: isolation-by-deployment

The key idea — **no multi-tenancy code is needed**. Each organization gets its **own**:

| Per-org boundary | What it isolates |
|---|---|
| Container / app | compute — one always-on instance |
| Persistent **volume** | the entire `data/` tree (profiles, memory, audit, SQLite/JSONL) |
| Secrets | that org's Anthropic / Composio keys |
| Subdomain + TLS | `acme.yourdomain.com` |

Isolation lives at the infrastructure boundary, not in the code. Adding an org = deploying
another instance. **local-first survives** in spirit: one tenant, one dataset, one owner.

> [!IMPORTANT]
> This means the storage engine does **not** change — SQLite + on-disk JSON/Markdown
> simply live on a mounted volume. No Postgres migration, no rewrite.

---

## Ideal stack

**Recommended: [Fly.io](https://fly.io).** Per-app Machines, persistent volumes, per-app
secrets, free TLS + custom domains, and `fly deploy` is effectively your one-command
install. Single-writer SQLite (the app takes a data-dir lock) maps cleanly to one Machine
+ one volume.

| Layer | Choice |
|---|---|
| Runtime | Node 24 LTS (matches the app; avoids the `better-sqlite3` native-build gap on newer Node) |
| Packaging | Docker image, Next.js **standalone** output (`node server.js`) |
| State | Fly **volume** mounted at `/app/data` |
| Secrets | `fly secrets set …` (never in the image or git) |
| Reachability | Fly app URL, then a custom subdomain per org |
| Access control | **See "Harden the gate" — required before any public route** |

**Alternatives:** Render or Railway (persistent disks, great UI-driven DX); or a small VM
(Hetzner/DO) + Docker Compose for full control at the cost of manual ops. **Not Vercel /
any serverless** — the filesystem is ephemeral there, so SQLite and the `data/` tree don't
survive between requests.

---

## Prerequisites (code changes to land first)

These are small but **required** for a correct, safe cloud instance. Do them before the
first real deploy:

1. **Canonical base URL.** Replace `window.location.origin` link-building (see
   `src/app/(workspace)/employees/page.tsx`) and any server-generated links / Composio
   OAuth callbacks with a configurable `APP_URL` (e.g. `https://acme.yourdomain.com`).
   Fall back to `VERCEL_URL`/`FLY_APP_NAME`-style detection only as a convenience.
2. **Harden the public gate.** Today `proxy.ts` protects a non-loopback bind with a
   shared startup token (30-day cookie) and carves out invite tokens. That token gates
   HTTP, but the app is **not yet hardened for the open internet** (see the README
   warning). Before exposing a public route, do at least one of:
   - Keep it **private** — reach it over `fly proxy` or [Tailscale](https://tailscale.com),
     no public route (best for the first test).
   - Put a real auth layer in front (SSO / reverse-proxy auth), and treat
     `EMPLOYEE001_TOKEN` as a high-entropy secret rotated per org.
3. **`.dockerignore`** that excludes `data/`, `.env*`, and `node_modules` — the image must
   never bake in secrets or one org's data.

---

## Files to add (starting templates — validate before shipping)

> These do not exist in the repo yet. Treat them as a starting point; test the build.

**`Dockerfile`** — verified: builds on Node 24, boots, and the `proxy.ts` auth gate
enforces `401` on a non-loopback bind. See the repo root [`Dockerfile`](../Dockerfile).

> [!IMPORTANT]
> Do **not** set `NODE_ENV=production` before `npm ci` — that skips devDependencies
> (`typescript`, `@tailwindcss/postcss`, …) and `next build` fails with
> `Cannot find module '@tailwindcss/postcss'`. Set it only in the final stage.

```dockerfile
FROM node:24-bookworm-slim AS base
# No NODE_ENV here — deps/build need devDependencies.

FROM base AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM base AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM base AS run
WORKDIR /app
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/node_modules/better-sqlite3 ./node_modules/better-sqlite3
# server.js reads HOSTNAME/PORT; proxy.ts middleware reads EMPLOYEE001_BIND to
# enforce the token gate. EMPLOYEE001_TOKEN is injected at runtime via fly secrets.
ENV NODE_ENV=production PORT=8080 HOSTNAME=0.0.0.0 EMPLOYEE001_BIND=0.0.0.0
EXPOSE 8080
VOLUME ["/app/data"]
CMD ["node", "server.js"]
```

**`fly.toml`**:

```toml
app = "acme-employee001"           # one per org
primary_region = "iad"

[build]

[env]
  PORT = "8080"
  EMPLOYEE001_BIND = "0.0.0.0"
  APP_URL = "https://acme.yourdomain.com"

[mounts]
  source = "e001_data"
  destination = "/app/data"

[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = false        # single always-on writer; do NOT autoscale to 0
  min_machines_running = 1
  max_machines_running = 1           # one writer — SQLite/data-dir lock is single-holder
```

> [!WARNING]
> Keep it to **one** Machine. The app takes a data-dir lock and is a single writer;
> running two Machines against one volume will corrupt state.

---

## Quick start — your own cloud

```bash
# 0. one-time
fly auth login
fly launch --no-deploy            # generates the app; keep the fly.toml above

# 1. persistent volume for data/
fly volumes create e001_data --size 3 --region iad

# 2. secrets (from your local .env — never commit these)
fly secrets set ANTHROPIC_API_KEY=… COMPOSIO_API_KEY=… EMPLOYEE001_TOKEN="$(openssl rand -hex 32)"

# 3. deploy
fly deploy

# 4. (first test) reach it privately, no public route
fly proxy 3000:8080            # → http://localhost:3000 tunneled to the Machine
```

Then migrate data (next section), point a subdomain at it (`fly certs add acme.yourdomain.com`),
and hand out invite links that now use `APP_URL`.

---

## Data migration — zero loss

Two paths; use the raw copy for a true "lose nothing" migration and `export`/`import` as
the clean, secret-free alternative.

**A. Raw `data/` copy (verbatim — recommended for the first migration).**
Stop the local server first so nothing is mid-write, then push the whole tree onto the volume:

```bash
# from the project root, with the Fly Machine reachable (fly ssh / sftp)
tar czf /tmp/e001-data.tgz data/
fly ssh sftp shell            # put /tmp/e001-data.tgz /app/data/../e001-data.tgz
# on the Machine: tar xzf /app/e001-data.tgz -C /app  (lands at /app/data)
```

**B. `export`/`import` (excludes secrets — set those via `fly secrets` separately):**

```bash
npx employee001 export ~/e001-backup.tar.gz     # local
# copy the archive onto the volume, then on the Machine:
npx employee001 import /app/data-backup.tar.gz --force
```

**Verify zero loss** — compare before/after on the same signals:

```bash
# counts that must match local vs cloud
find data/employees -maxdepth 1 -type d | wc -l      # twins
wc -l data/audit.jsonl                               # audit entries
find data/memory -name cards.jsonl -exec cat {} + | wc -l   # memory cards
```

---

## Security checklist (per org)

- [ ] Secrets in `fly secrets`, **not** in the image, `fly.toml`, or git.
- [ ] `.dockerignore` excludes `data/`, `.env*`.
- [ ] First test stays **private** (`fly proxy` / Tailscale) until the gate is hardened.
- [ ] `EMPLOYEE001_TOKEN` is high-entropy and unique per org.
- [ ] Volume backups scheduled (`fly volumes snapshots`), since the volume *is* the org's brain.
- [ ] One Machine only (single writer).
- [ ] `APP_URL` set so invite links + OAuth callbacks resolve to the real domain.

---

## What this does NOT do

- It is **not** multi-tenant. One instance = one org. That is the point.
- It does **not** move you to a database. `data/` on a volume is the whole story.
- It does **not** make the app safe on a wide-open public port by itself — the gate must
  be hardened or kept private first.
