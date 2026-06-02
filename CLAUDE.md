# CLAUDE.md — Employee001

Guidance for AI agents (and humans) working in this repo.

## What this is

`employee001` — a local-first "organizational brain": agent twins of real
employees, running on the user's own machine. Next.js 16 (App Router, Turbopack),
React 19, TypeScript (strict). Published to npm as **`employee001`** (`npx employee001`).

## Releasing

This repo publishes via a **tag-triggered** GitHub Actions workflow
(`.github/workflows/release.yml`, fires on `push: tags: v*`).

**Use the global `/release` skill** (`~/.claude/skills/release/`) for the full
runbook — it handles preflight gates, the version bump, the tag push, and
watch + verify. Repo-specific details it should honor:

- **Cadence:** pushes to `main` run CI only (`ci.yml`: lint + build) — they do
  **not** publish. Only a `vX.Y.Z` tag publishes. Commit/push freely; batch many
  commits into ONE release. Do not release per commit.
- **Bump command uses `--ignore-scripts`** (the project's chosen flow — skips the
  `preversion`/`postversion` hooks so the push is explicit):
  ```bash
  npm version <patch|minor|major> --ignore-scripts -m "release: v%s"
  git push origin main --follow-tags
  ```
- **Data-leak scan:** `release.yml` runs a post-build scan to ensure no `data/`
  directory or `.env` ships in the tarball. When verifying a publish, confirm the
  packed tarball contains only `bin/ .next/ public/ .env.example README.md LICENSE`
  — never `data/`.
- **Version-tombstone gotcha:** a published-then-unpublished npm version number is
  permanently retired (e.g. `0.1.0` is dead — that's why first stable shipped as
  `0.1.1`). Never reuse a number; always bump forward.

## Conventions

- Work directly on `main` (solo repo) unless asked otherwise.
- Inline-style objects with CSS custom properties (`var(--text)`, `var(--surface)`,
  `var(--hairline)`, `var(--sp-*)`, `var(--fs-*)`) + framer-motion. No Tailwind /
  shadcn in the app UI.
- Secrets live in `.env.local` (gitignored). The Claude Code harness shell exports
  an empty `ANTHROPIC_API_KEY` that shadows `.env.local`; when launching the dev
  server from that shell, `unset ANTHROPIC_API_KEY` first so `.env.local` wins.
- **npm supply-chain:** never consume a dependency version published <7 days ago
  (Shai-Hulud worm family). See `docs/SECURITY-SHAI-HULUD.md` for the scan runbook.
  TipTap is pinned to `3.23.6` via `package.json` overrides for this reason.

## Key surfaces

- `/profile` — twin profile; **Files** tab is a split-pane TipTap editor over the 9
  base profile files + an uploadable `knowledge/` dir the twin reads on demand.
- `/handover` (+ `/handover/live`) — Relay: captures a departing employee's knowledge
  into a portable Role Context Package (`rcp.json`). **DEMO module — not published.**
- `/flow`, `/cockpit`, `/connections` — twin chat with live memory graph, run
  observability, and Composio tool connections.
