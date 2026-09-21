---
name: deploy-fly
description: Deploy a single-tenant Employee001 to Fly.io — one always-on cloud instance for an org, with all data on a persistent volume and the data staying the org's. Use when someone wants to run Employee001 in the cloud, make invite links reachable for remote employees, or "deploy my own cloud version". Not a multi-tenant SaaS — one app + one volume + one Machine per org.
---

# Deploy Employee001 to Fly.io (single-tenant)

Stand up one **always-on** Employee001 instance for a single organization so remote
employees can reach their twins from anywhere — while the org's data lives on a
persistent volume **they** own. Isolation is by deployment: one org = one Fly app +
one volume + its own secrets + its own subdomain. **No multi-tenancy code, no database
migration** — the on-disk `data/` tree just lives on a mounted volume.

Full human runbook with rationale: [`docs/DEPLOY-CLOUD.md`](../../../docs/DEPLOY-CLOUD.md).

## When to use
- An org wants Employee001 in the cloud, or invitations "don't work" because the local
  server is on `127.0.0.1` (invite links point at the recipient's own loopback).
- You are setting up a paid/managed deployment for an org.

## Guardrails (read first)
- **Never enter the org's API keys yourself.** The person runs `fly secrets set` in their
  own terminal (step 4). Keys must not pass through the agent.
- **One Machine only.** The app takes a single-writer data-dir lock; two Machines on one
  volume corrupt state. `fly.toml` already pins this — don't scale it.
- **The gate is the only thing between the internet and the org's brain.** `proxy.ts`
  requires `EMPLOYEE001_TOKEN` on a non-loopback bind (fails closed with 503 if unset).
  For a first deploy, prefer reaching it **privately** via `fly proxy` until you've added
  real auth in front — the token gate is not yet hardened for a hostile public internet.
- Deploy from a checkout of `main` that has the current security fixes; the image builds
  its own deps from the lockfile.

## Prerequisites
- Fly CLI installed and authenticated: `fly auth whoami`.
- This repo checked out. It ships a **verified** `Dockerfile` and `fly.toml` at the root
  (Node 24, Next.js standalone, `better-sqlite3`, `data/` volume at `/app/data`).
- Node 24 (for any local build/reinstall): `export PATH=…/nvm/versions/node/v24.4.1/bin:$PATH`
  — Node 26 breaks `better-sqlite3`'s native build.

## Steps

**1. Pick a name + region.** Copy `fly.toml` and set `app` (one per org, globally unique)
and `primary_region` (nearest Fly region — e.g. `fra` for EU/Israel).

**2. Create the app + a persistent volume** (region must match `primary_region`):
```bash
fly apps create <org>-employee001
fly volumes create e001_data --region fra --size 3 --app <org>-employee001 --yes
```
The volume is encrypted with scheduled snapshots on — it *is* the org's brain, so those
snapshots are the backups.

**3. (Optional) Fly partner coupon.** If deploying under the Employee001 × Fly program,
apply the org/promo code at org creation or in the Fly dashboard billing before deploy.
`# TODO: partnership coupon code — pending Fly agreement`

**4. Set secrets — the person runs this in THEIR terminal, not you.** It reads values
from `.env.local` so the keys never appear in the command, and mints a fresh gate token:
```bash
set -a; . ./.env.local; set +a
fly secrets set -a <org>-employee001 \
  ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" \
  COMPOSIO_API_KEY="$COMPOSIO_API_KEY" \
  AI_GATEWAI_API_KEY="$AI_GATEWAI_API_KEY" \
  EMPLOYEE001_TOKEN="$(openssl rand -hex 32)"
```
Verify names (not values) are staged: `fly secrets list -a <org>-employee001`.

**5. Deploy:**
```bash
fly deploy --remote-only -a <org>-employee001
```

**6. Migrate data with zero loss** (for an existing local install). Stop the local server
first so nothing is mid-write, then push the whole `data/` tree onto the volume, e.g. via
`fly ssh console` + `sftp`, or seed it before first boot. Then **verify counts match**
local vs cloud:
```bash
find data/employees -maxdepth 1 -type d | tail -n +2 | wc -l   # twins
wc -l data/audit.jsonl                                          # audit entries
find data/memory -name cards.jsonl -exec cat {} + | wc -l       # memory cards
find data -type f | wc -l                                       # total files
```
For a fresh org with no local data, skip this — the app creates `data/` on first run.

**7. Reach it.** First test: `fly proxy 3000:8080 -a <org>-employee001` → open
`http://localhost:3000/?token=<EMPLOYEE001_TOKEN>` (get the token from the person or the
`fly secrets` output). Once the gate is hardened (Phase 4 in the runbook), add a subdomain:
`fly certs add <org>.yourdomain.com` and set `APP_URL` so invite links resolve.

## Verify success
- `fly status -a <org>-employee001` shows one Machine running in the target region.
- `fly logs` shows `✓ Ready`.
- Unauthenticated `/api/*` returns `401` (gate active); authenticated returns data.
- Migrated counts match the local baseline exactly.

## Do NOT
- Deploy to Vercel or any serverless host — the filesystem is ephemeral there, so SQLite
  and `data/` don't survive.
- Run more than one Machine, autoscale to zero, or bake secrets/`data/` into the image
  (`.dockerignore` already excludes them).
