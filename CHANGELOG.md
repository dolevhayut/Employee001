# Changelog

All notable changes to Employee001 are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added — `/flow` chat experience
- **`AskUserQuestion` wired end-to-end.** The SDK's clarification tool
  was firing but events fell through both the SSE route and the chat
  pane; the agent paused forever on "Thinking…". Now renders the same
  `ClarificationCard` the council page uses.
- **Three follow-up suggestion chips after each twin reply**, generated
  by a small `claude-haiku-4-5` call in the user's language. Suppressed
  when the twin's reply itself ends with a question, so chips don't
  compete with the agent's own beat.
- **Copy button** on every twin reply, sized up alongside the existing
  confidence + listen pills.
- **File attachments via paperclip.** Uploads to
  `data/uploads/<employeeId>/`, spliced into the next prompt as an
  `<attached>` block with absolute paths so the SDK Read tool works
  on first try. 25 MB cap, filename slugified.
- **Retry + edit affordances** on user messages that didn't get a
  reply (run cut off, fetch failed). Retry replays the original
  composed prompt; the new reply lands at the end of the thread;
  `answeredBy` linkage clears the retry chip the moment text streams.
- **`beforeunload` guard while streaming.** Browser confirm dialog
  fires only during an in-flight turn, so closing the tab mid-stream
  doesn't silently lose the answer.

### Added — `/settings` custom MCP servers
- **Preset catalog with one-click Quick add** for Apify, Stripe,
  GitHub, Linear, Firecrawl, Vapi (Bearer-token) and Higgsfield (OAuth).
- **Brand logos** via Composio's toolkit catalog, with a static-asset
  override path for vendors Composio doesn't carry (Higgsfield).
- **Full OAuth bridge for MCP servers.** Discovery,
  Dynamic Client Registration, PKCE S256, code exchange,
  refresh-on-expiry, injection of `Authorization: Bearer <token>` at
  runtime. Unlocks every standards-compliant OAuth MCP server.
- **Token refresh handled lazily** in `loadOrgCustomMcpServers` — the
  runner never sees a stale token; expired refresh tokens surface as
  a clean reconnect prompt.

### Added — installer + observability
- **Setup wizard: chained start.** Setup ends with a "Start
  Employee001 now? [Y/n]" prompt; on yes the start command runs
  in-process so the server boots + browser opens without a context
  switch.
- **`/employees` inline missing-key recovery.** When the invite gate
  reports an unset Anthropic or Composio key, the banner now shows a
  password input + Save button that PATCHes `/api/system/config`
  (writes `.env` + mutates `process.env`) — no restart needed.
- **`/api/twin/chat` logs to task-history.** Every chat run appends
  `costUsd`, `turns`, `toolCalls`, `confidence`, so the sidebar
  **Twin Spend · MTD** reflects real spend (previously: $0 forever,
  because only `/api/employees/[id]/task` was logging).

### Added — routines
- **Visible feedback on "Run now"** — button flips to "Running…" with
  a spinner; in-page polling waits for `lastRunAt` to advance (up to
  3 minutes) before re-enabling. Shift runs previously gave zero
  indication that anything happened.
- **PATCH supports schedule + task + name changes.** Re-tuning a
  routine no longer requires delete + recreate (which lost run
  history). `nextRunAt` is recomputed on schedule change.
- **Clearer Shift-kind copy** in the routine modal — explains each
  fire is one autonomous run with accumulating state, points users
  at `Every N min` for continuous autonomy.

### Added — `/employees` + `/profile`
- **Org chart on `/employees`** — collapsible react-flow tree of
  CEO → human reports → managed agents.
- **`/profile` Overview tab now reads per-twin.** Pulls bullets out
  of the live `EXPERTISE.md` / `BOUNDARIES.md` instead of showing
  hardcoded "Engineering leadership" + "escalate to Sarah".

### Changed
- **Setup wizard: Composio key is optional.** Marketplace agents
  work entirely without Composio; the invite panel surfaces a paste
  + save UI the moment a real-employee invite needs the key. Cuts
  "from `npx` to first chat" from ~20 minutes to ~3.
- **Sidebar: "Twins" → "Chat With Twin".** Previous label was
  ambiguous against `/twin-build`.
- **`/flow` user bubble strips the `<attached>` scaffolding** for
  display. The backend still receives the composed prompt.
- **Light-mode contrast pass** on three more surfaces — cockpit
  StatusPill, marketplace success toast, council Download chip.

### Fixed
- **Pending invite ghosts no longer pollute `/employees` or the org
  chart.** Sidecars with `pendingProfile: true` are skipped by
  `loadEmployeesFromDisk`; the placeholder markdown was scoring as
  "ready".
- **Marketplace trial chat drawer** for previewing an agent before
  hiring; the trial session never persists into the roster.

---

## [0.1.0-rc.8] — 2026-05-18

### Added
- **Marketplace trial chat drawer.** Try an agent before hiring —
  right-side drawer with live SSE-streamed chat against the
  marketplace profile. Trial session lives in a dotted directory
  (`data/employees/.trial-<agentId>/`) so it never leaks into the
  roster, org chart, or audit log.
- **Org chart on `/employees`.** Collapsible react-flow tree of
  CEO → human reports → managed agents. Solid lines for human
  reports, dashed for AI agents; status ring on every node.

### Changed
- **Light-mode CTA contrast.** Marketplace "Hire agent" / "Looks
  good — hire" CTAs, HirePlacementModal "Join team" button, trial
  drawer user bubble — all moved from `var(--accent)` + `#fff` (which
  vanishes in light theme) to the `var(--text)` / `var(--bg)`
  inversion that reads in both themes.

---

## [0.1.0-rc.7] — 2026-05-16

### Added
- **Community-health docs.** `SECURITY.md` with concrete disclosure SLAs, `CODE_OF_CONDUCT.md`, `CHANGELOG.md`, `.github/ISSUE_TEMPLATE/` (bug + feature), `.github/pull_request_template.md`, and `.github/dependabot.yml` for weekly security updates.
- **Real starter content for all 9 twin profile files.** `/api/invites/<token>/complete` now synthesises CONTEXT, DECISIONS, PEOPLE, PROJECTS, PREFERENCES, TONE from the wizard's collected data (previously placeholders).
- **Weekly activity tracking.** `employees-disk.ts` exposes `bumpActivityOnDisk`; `/api/twin/chat` bumps it on every request. The UI now shows real `questionsThisWeek` counts that auto-reset on ISO week boundaries.
- **In-UI API key management.** `/settings` lets the CEO add/clear Anthropic, Composio, and ElevenLabs keys without dropping to a terminal.
- **`update` CLI command actually updates.** Detects npm/pnpm/yarn installation method, prompts before running, falls back to printing the command on unknown setups.
- **Audit log rotation.** `audit.jsonl` is split into monthly `audit.YYYY-MM.jsonl` archives once it crosses 10MB or contains entries older than 30 days.
- **README screenshots.** Four PNGs (welcome, employees, flow, settings) replace the placeholder comment. `scripts/screenshot.mjs` regenerates them via Playwright.

### Changed
- `.gitignore` now ignores `.claude/` (Claude Code session metadata stays local).

---

## [0.1.0-rc.6] — 2026-05-16

### Changed
- CI release workflow auto-detects pre-release versions and publishes under the correct npm dist-tag (`next` for rc, `latest` for stable)

### Chores
- `docs/local/` gitignored to keep session notes and build logs out of the repo

---

## [0.1.0-rc.5] — 2026-05-15

### Added
- Invite creation is now blocked with a clear error when Anthropic or Composio API keys are missing — prevents silent failures during employee onboarding
- Brand fonts loaded at the root layout for consistent typography across all pages

### Fixed
- Real profile data now stored and served from disk; employee roster is fully disk-backed
- Employee card "done" state wired up correctly

---

## [0.1.0-rc.4] — 2026-05-14

### Added
- Copy-paste invitation links for CEO-driven employee onboarding — no terminal required for the employee side

---

## [0.1.0-rc.3] — 2026-05-13

### Added
- First-run CEO onboarding flow with founder introduction and onboarding video

### Changed
- Removed `EMPLOYEE001_DEMO` flag, baked-in personas, and all hard-coded demo data — fresh installs start from a clean slate

---

## [0.1.0-rc.2] — 2026-05-12

### Fixed
- Removed demo-id fallbacks that caused fresh installs (without `EMPLOYEE001_DEMO=true`) to behave unexpectedly

---

## [0.1.0-rc.1] — 2026-05-11

### Added
- Tag-driven GitHub Actions release workflow — push a `vX.Y.Z` tag to publish to npm automatically
- CI pipeline: lint + build on every push and pull request

### Infrastructure
- `CONTRIBUTING.md` — contribution guidelines, ground rules, and security contact

---

## [0.1.0] — 2026-05-10

### Added
- Initial public release
- Agent twins for every employee — always-on AI twins built from markdown profiles
- Twin council meetings — multi-twin debate and convergence on a single question
- Real tool execution via Composio MCP — Slack, Linear, email, code, and more
- Org Brain — shared knowledge graph every twin reads from
- On-prem by design — binds to `127.0.0.1`, all data stays in `./data/`
- Shared-secret token to gate LAN-exposed installs
- CLI commands: `setup`, `start`, `update`, `doctor`, `help`
- Human-controlled autonomy — approval gate before any sensitive tool call executes

[Unreleased]: https://github.com/dolevhayut/Employee001/compare/v0.1.0-rc.8...HEAD
[0.1.0-rc.8]: https://github.com/dolevhayut/Employee001/compare/v0.1.0-rc.7...v0.1.0-rc.8
[0.1.0-rc.7]: https://github.com/dolevhayut/Employee001/compare/v0.1.0-rc.6...v0.1.0-rc.7
[0.1.0-rc.6]: https://github.com/dolevhayut/Employee001/compare/v0.1.0-rc.5...v0.1.0-rc.6
[0.1.0-rc.5]: https://github.com/dolevhayut/Employee001/compare/v0.1.0-rc.4...v0.1.0-rc.5
[0.1.0-rc.4]: https://github.com/dolevhayut/Employee001/compare/v0.1.0-rc.3...v0.1.0-rc.4
[0.1.0-rc.3]: https://github.com/dolevhayut/Employee001/compare/v0.1.0-rc.2...v0.1.0-rc.3
[0.1.0-rc.2]: https://github.com/dolevhayut/Employee001/compare/v0.1.0-rc.1...v0.1.0-rc.2
[0.1.0-rc.1]: https://github.com/dolevhayut/Employee001/compare/v0.1.0...v0.1.0-rc.1
[0.1.0]: https://github.com/dolevhayut/Employee001/releases/tag/v0.1.0
