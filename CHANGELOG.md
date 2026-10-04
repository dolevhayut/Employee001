# Changelog

All notable changes to Employee001 are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Fixed
- **Unattended work starts with the server.** Schedules, catch-up of missed
  runs and recovery of approvals lost in a restart used to wait until someone
  opened Schedules or Tasks.
- **The Autonomy switch looks on when it is on** (it was grey in every theme).
- **"Run routine again" is reachable.** The review popup now offers it
  (instead of Approve/Reject) when a routine run was skipped or lost in a
  restart; before, the popup covered the button in Approvals.
- **Suggested knowledge updates carry the meeting's real date.**
- **Schedules no longer shows an empty box on shift routines.**
- **Dark and cool themes on Settings, Team Meeting, Cockpit, Schedules,
  Tasks, Approvals, twin training, Live interview, Hire and the org chart.**
  Hire also used theme names that did not exist, so some of its text had no
  themed color at all.
  Status badges, file chips, tool tints and dialogs now follow the theme
  instead of fixed light-mode colors.
- **The knowledge graph, the Activity log and chat dialogs follow the
  theme too.** The graph recolors live when you switch themes.
- **Approval gate hardened.** Bash and the other never-allowed built-in
  tools are refused by the policy layer too, destructive tool names
  (delete, refund, payment, fund transfer, user removal) are caught
  regardless of naming style, and look-alikes that read data ask first
  instead of running automatically. Schedules reject malformed cron
  expressions.
- **No silently skipped work.** When an unattended run's approval request
  waits too long (6 hours), Approvals now shows what was skipped and why.
  For scheduled routines, that item and the "lost in restart" ones get a
  one-click "Run routine again".
- PDF and Word extraction can't take the server down: Word files that
  expand suspiciously (zip bombs) are refused before they are opened, and
  extraction runs in a separate worker with a memory cap and a 30-second
  limit. The upload itself always succeeds.
- Cockpit, Spend and Approvals show "Couldn't load …" with Try again when
  their data fails to load, instead of pretending the page is empty. A view
  that already loaded stays on screen with a quiet "Couldn't refresh".
- **Twins say they work at your company, not "Employee001".** The company
  name and a one-line description are saved from Setup and
  Settings → Workspace (they weren't saved before), and Team Meetings and
  shifts use them.
- Setup, Sources and Join pages follow the light, dark and cool themes
  (they used hard-coded colors). The setup wizard's theme previews each
  show their own theme.
- The sidebar version label reads `package.json` at build time instead of a
  hard-coded "v0.4".
- **Hebrew replies render right-to-left.** Every paragraph, list, heading,
  quote and table in twin messages picks its own direction (`dir="auto"`), so
  Hebrew lines run right-to-left and mixed Hebrew/English text no longer
  scrambles punctuation. Lists and quotes use logical (start/end) spacing.

### Changed
- **Twins recall the right memory first more often.** Keyword recall now
  weighs rare, decisive words (like "GDPR" or "CSV") above common ones, so
  without embeddings the top memory is the relevant one in 11 of 11
  benchmark questions, up from 8.
- **Operator pages explain themselves when Autonomy is off.** Cockpit, Spend,
  Activity log, Schedules and Approvals show what will appear there once twins
  work unattended, with a one-click "Turn on Autonomy" (no reload). Pages with
  real data are unchanged. Schedules gets a Focus tab, and Spend links to
  Workspace costs.
- **Handover has tabs** (Handover / Live interview). Page titles use the new
  sidebar names, and Templates and org-wide MCP servers are one click away
  from Tasks, Settings and Tools & MCP.
- **New sidebar.** One navigation for both modes: Work (Approvals with a
  pending-count badge, Tasks, Team Meeting), Twins (Twins, Chat, Hire),
  Operations (Cockpit, Schedules, Activity log), Control (Spend, Tools & MCP)
  and Labs (Handover). Operator pages no longer disappear when Autonomy is
  off; Autonomy now only arms or disarms unattended work. The command palette
  uses the same names and still finds the old ones (Employees, Routines,
  Audit, Budgets, Inbox, Marketplace).
- **Twins default to Claude Sonnet 5.5** (`claude-sonnet-5-5`), with Sonnet 5
  as the fallback. Existing twins keep the model they were built with.

### Added
- **Brain Cosmos.** The memory graph in Chat is now a living 3D brain:
  the twin's knowledge files are neurons inside a particle brain, and you
  watch it think — impulses travel along synapses to the file being read,
  the neuron blooms, cited files send a shockwave, and the camera follows the
  thought. Built with three.js and anime.js. "Classic" switches back; it
  falls back automatically without WebGL2 or with reduced motion.
- **Tamper-evident audit log.** Every new approval-gate entry is hash-chained
  to the one before it, `GET /api/audit/verify` checks the whole chain across
  rotated archives, and the Activity log shows the result. Entries written
  before this version are counted as legacy, not as tampering.
- **Local model provider (offline).** `employee001 setup` can point twins at a
  local Anthropic-compatible endpoint (for example Ollama >= 0.14) with
  explicit model pins. It fails closed when misconfigured, never forwards your
  Anthropic key, and `doctor --egress` shows whether traffic stays on this
  machine. Open-weights models are much weaker than Claude: evaluation and
  air-gapped pilots only.
- **Boundary mode: run Claude in your own cloud.** `employee001 setup` can
  point twins at Claude on AWS Bedrock, Google Vertex AI or Azure AI Foundry
  instead of the Anthropic API. In that mode, features that call the
  Anthropic API directly (memory rerank, follow-up suggestions, knowledge
  proposals, live Relay) stay off unless you allow them, so prompts stay in
  your cloud. Settings shows where Claude runs, and `doctor --egress`
  reflects it.
- **Twins learn from Team Meetings, with your OK.** After a meeting, each
  twin that spoke can suggest a short addition to its knowledge files (a
  decision, an owner, a deadline). Suggestions appear under "Suggested
  updates" in the twin's Files tab; nothing is written until you accept, and
  accepted text keeps file history. Capped per meeting and within each
  twin's budget; turn off with `TWIN_KNOWLEDGE_PROPOSALS=0`.
- **Hebrew interface, first steps.** Settings → Workspace has an
  English / עברית switch. In Hebrew the app runs right-to-left in
  Niv Sans; the sidebar, command palette (search works in both languages),
  page titles, empty states, Settings, the Twins roster, the org chart,
  Approvals, Chat, Team Meeting, the twin profile, the operator and work
  pages and onboarding are translated, with dates in the local format. More screens
  follow. English
  stays the default and doesn't load the Hebrew font.
- **Knowledge files keep their history.** Editing or deleting a twin's
  knowledge file saves the previous version (last 50 per file). In the Files
  tab, History shows each version with "Show changes" and "Restore", and
  "Recently deleted" brings back files you removed.
- **See what changed between profile versions.** In a twin's Versions tab,
  "Show changes" highlights added and removed lines against the current
  file, so you can check before restoring.
- **`npx employee001 doctor --egress`** lists every outside host your
  current configuration talks to (Anthropic or your cloud provider,
  Composio, OpenAI embeddings, ElevenLabs, each custom MCP server, web
  research, updates) and what is sent, without printing any secret.
  `npx employee001 start --strict` turns off nonessential traffic.
- **Hebrew name per twin.** Set a twin's Hebrew spelling from its profile
  ("Add Hebrew name"); twins use it when they write in Hebrew. The sidebar,
  profile and org chart show your company's name instead of "Employee001".
- **PDF and Word files become readable knowledge.** Uploading a `.pdf` or
  `.docx` to a twin's `knowledge/` keeps the original and writes
  `NAME.pdf.md` / `NAME.docx.md` with the extracted text (capped at 2 MB), so
  the twin can read it. If extraction fails, the upload still succeeds and
  shows a warning. Deleting the original also removes its generated text.
  Hebrew in PDFs comes out in the right reading order, including mixed
  tokens like "ב-10:30" and acronyms like צה"ל.
- **Twins write natural Hebrew.** A shared language section in every twin
  prompt (chat, Team Meeting, shifts) asks for idiomatic Israeli workplace
  Hebrew, translated jargon, and English only where Israelis keep it (product
  names, code, acronyms).
- **Hebrew name spellings.** An optional `nameHe` field in `employee.json`
  gives the twin each colleague's real Hebrew name (נועה, not נואה).
- **Twin memory abstains when nothing is relevant.** Recall now passes a
  relevance gate (keyword overlap or semantic similarity ≥ 0.25) before
  salience is applied — salience reorders what survived, it no longer
  qualifies a card on its own. Previously every query injected a full five
  "memories" into the twin's prompt even when none were on-topic. Escape
  hatch: `TWIN_MEMORY_RELEVANCE_GATE=0`; floors tunable via
  `TWIN_MEMORY_MIN_KEYWORD` / `TWIN_MEMORY_MIN_SEMANTIC`.
- **Optional agentic rerank** (`TWIN_MEMORY_AGENTIC_RERANK=1`). One cheap
  model call reads the shortlist and keeps only cards about the question's
  subject (Hebrew + English). On the bench: precision over returned cards
  0.21 → 0.91 and recall@5 0.81 → 1.0 with Haiku 4.5, at ~1.5s per query.
  Off by default because it sits ahead of the twin's first token.
- **One-command single-tenant cloud deploy to Fly.io** — Dockerfile,
  `fly.toml`, runbook in `docs/DEPLOY-CLOUD.md`.

### Changed
- **Calmer, clearer themes on Radix Colors.** Every theme color is now a step
  of an established scale (sand for text, brown for surfaces and accent, and
  olive/gold/tomato for status), so layers no longer blend together: the frame,
  panels, cards and borders each sit on their own step. Status colors are earth
  tones instead of neon green and red. The twin color is slate.
- **Floating shell.** The sidebar and the content area are rounded panels
  inset from the window edges.
- **New app typeface: Geist** everywhere, with **Geist Mono** for code, IDs
  and numbers. Instrument Serif stays as the display serif.
- Twin models upgraded to the Claude 5 family (Opus 5, Sonnet 5).
- Expanded the memory tokenizer's stopword list so question scaffolding
  ("how do we", "what is our") no longer counts as topical overlap.

## [0.5.0] — 2026-06-27

### Added
- **Smarter twin memory layer.** Each memory now carries a **salience score**
  that rises when recalled and decays with a 14-day half-life, so used memories
  surface and stale ones fade — no manual cleanup. **Dedup-on-write** reinforces
  a near-identical memory instead of storing a duplicate. The **Dreamer**
  distills durable, typed facts (decision · preference · fact · contact · todo ·
  milestone · problem · emotional) from conversations and surfaces them to the
  twin as higher-authority memory.
- **Multilingual fact extraction (Hebrew).** The Dreamer now distills facts with
  Claude (Haiku) when an Anthropic key is present — handling **Hebrew and English
  natively**, using the key the CLI already collects (no OpenAI dependency). It
  falls back to the English regex patterns offline.
- **Optional OpenAI key in `setup`.** The install wizard now offers an optional
  OpenAI key that sharpens twin memory (more accurate recall of relevant past
  context). Everything still works without it.
- Deterministic memory-layer benchmark harness (`.memory-bench/`, dev-only).

## [0.4.0] — 2026-06-25

### Changed
- Upgraded twin models from **Claude Opus 4.7 → 4.8** across defaults and copy.

### Performance
- **−52% download size** (packed 31 MB → 14.9 MB; unpacked 89.5 MB → 52.6 MB).
  Disabled server-side image optimization (`images.unoptimized`) so the
  transitive `sharp` dependency — ~33 MB of Linux-only native binaries, dead
  weight on macOS/Windows — drops out of the standalone bundle.

### Removed
- Internal `docs/` (~13 MB, incl. private planning notes) no longer traced into
  the published tarball — a size win and an information-leak fix.

## [0.3.1] — 2026-06-03

### Added
- **Full activity log per shift run.** The routine detail modal now has an
  expandable **Activity log** showing the run's complete timeline the way
  agentic frameworks do — the twin's extended-thinking, its narration, every
  tool call **with inputs**, tool results, and approval requests/decisions,
  in order. Shifts now capture `thinking` and `text` events into the archive
  (`events.jsonl`) and run-log; exposed via `GET /api/shifts/[runId]?events=1`.
- **Shift history.** The routine detail modal now lists every past run of
  a twin's shift (status, time, one-line summary, deliverable count), read
  from the per-shift archives. Selecting a run loads its summary and
  deliverables, so you can browse what the twin produced across days — not
  just the latest run. Backed by `GET /api/shifts?employeeId=` and a
  `listShiftArchives` reader.
- **Shift deliverables are visible in the UI.** The routine detail modal
  now has a **Deliverables** section that lists what an autonomous shift
  actually produced — written documents (openable in an inline markdown
  viewer), generated image/video URLs, files, and links — read from the
  per-shift archive. Backed by a new `GET /api/shifts/[runId]` endpoint
  (`readShiftArchive` / `readArtifactContent`); routines now persist
  `lastRunId` so the modal can find the run's archive.
- **Markdown documents are first-class shift deliverables.** A shift twin
  can return a written document (brief, report, draft, post, spec) by
  putting the full markdown in `outputs[].content`; it's saved as a real
  `.md` file under `data/shifts/<runId>/artifacts/` and recorded in
  `outputs.jsonl` — so a doc the twin writes is an openable artifact, the
  way agentic workflows produce them, not just a mention.

### Changed
- **Routine modal: employee field is now a proper twin picker.** The bare
  browser `<select>` was replaced with the (previously unused) themed
  `EmployeePicker` dropdown — avatar + name + **role** + twin-status dot,
  matching the rest of the app. Generalised it into a controlled,
  routing-free, theme-aware form control (`value` / `onSelect` /
  `navigate={false}`) so it works inside modals, not just the /flow top bar.
- **Redesigned `/employees` invite panel.**

### Fixed
- **Skip the `/setup` wizard when an org already exists** — route straight to
  the launchpad instead of re-running first-run setup.

## [0.3.0] — 2026-06-03

### Added — shifts take real action with live CEO approval
- **Autonomous shifts can now run action tools (generate images/video,
  post, send) — gated by a live approval, not silently blocked.**
  Previously an unattended shift *denied* every non-read-only tool and
  told the twin to defer it, so a "create marketing content" shift could
  never actually call an image/video service. Now any such call raises a
  real approval request and the shift **pauses** until the CEO responds.
- **Reuses the existing approval surface.** The request appears in the
  same `GlobalApprovalOverlay` (Approve / Edit args / Skip) used by chat
  and council — no new UI. Approving with edited args is supported.
- **Background approvals wait far longer than chat ones.** Per-surface
  TTL in the approval bus: `chat` stays 10 min (CEO is present), a
  shift's `background` approval waits up to **6 hours** before the
  backstop denies it — so a shift genuinely blocks on the CEO.

### Added — per-shift output archive
- **Every shift now writes a durable, organised record** under
  `data/shifts/<runId>/`: `manifest.json` (who/when/cost/status +
  approval decisions + output count), `events.jsonl` (full chronological
  history — tool calls, tool *results*, approvals), and `outputs.jsonl`
  (distilled deliverables: image/video URLs, files, links).
- **Tool results are captured, not just tool calls.** URLs are extracted
  from results automatically and recorded as outputs; oversized/base64
  payloads are summarised so the archive never bloats.
- **`ShiftReport.outputs`** — a new structured field the twin fills with
  every deliverable it produced, merged into the archive. The shift
  run-log (`tool_result`) now carries the (truncated) result payload too,
  so the live cockpit view shows what each tool returned.

## [0.2.0] — 2026-06-03

### Added — twin-to-twin consultation during shifts
- **A twin on an autonomous shift can now consult another twin,
  synchronously, mid-run.** Previously a single-twin shift (e.g. a
  designer's "create marketing content" routine) had no way to get a
  colleague's input without filing an async task and waiting for that
  twin's next shift. Now it can ask and keep working in the same run.
- **Two new in-process MCP tools**, the twin chooses which fits:
  - `consult_twin(targetEmployeeId, question)` — ask a peer for advice;
    their reply comes back as the tool result and the asking twin
    continues with it in hand.
  - `request_approval(approverEmployeeId, what, context)` — ask a peer
    (e.g. the CEO-twin) for a go/no-go before acting. Returns an
    approve/reject verdict **and** logs the decision to `/inbox` so a
    human can review and override it.
- **Fully local** — a consultation is just a nested twin run; the only
  external call is the Anthropic API the app already uses. No cloud
  state, in keeping with the on-prem design. (Anthropic's hosted
  *Managed Agents* was evaluated and rejected for this: it persists
  session state server-side, which conflicts with local-first.)
- **Loop-safe by construction.** A shared `visited` set (seeded with the
  requester) means no twin is consulted twice in a run and a twin can't
  consult itself; a depth cap (`maxDepth = 3`) bounds consultation
  chains — mirrors the council `@mention` delegation guard. Each
  consultation hop runs "light" (no personal/org MCP, lower turn + $0.50
  budget cap) so chains stay cheap.
- New `src/lib/twin-consult.ts` (orchestration) + `src/lib/consult-mcp.ts`
  (tool surface); `runSingleTwin` gained `consultMode` / `consultContext`
  options and `shift-runner` wires a consult context into every shift.

### Added — per-twin knowledge directory + editor
- **`knowledge/` directory per twin.** A new
  `data/employees/<id>/knowledge/` folder where the CEO uploads and
  edits extra reference files that enrich the twin's brain, kept
  **separate** from the 9 base profile files (EXPERTISE, TONE, CONTEXT,
  DECISIONS, PREFERENCES, PEOPLE, PROJECTS, BOUNDARIES, EMPLOYMENT).
- **Text formats are editable and agent-readable:** `.md`, `.markdown`,
  `.txt`, `.csv`, `.json`. Any non-blocked binary can be uploaded (25 MB
  cap); an executable/script blocklist (`.exe`, `.sh`, `.js`, `.ts`, …)
  is always rejected, and filenames are sanitized against path traversal.
- **Twin consumption is lazy, not pre-loaded.** Only a compact index of
  the files (path + approx token count) is injected into the twin's
  system prompt. The agent reads the relevant file on demand via its
  existing Read/Grep/Glob tools (cwd = `data/` root) — no new MCP tool.
- **Own parallel API**, separate from the base-file route:
  `GET/POST /api/employees/[id]/knowledge` (list / create-or-upload) and
  `GET/PUT/DELETE /api/employees/[id]/knowledge/[name]`.
- **`/profile` "Files" tab is now a split-pane TipTap editor** (the old
  "Preview" tab was removed). TipTap is pinned to `3.23.6` via
  `package.json` `overrides` to honor the 7-day npm supply-chain rule.

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

[Unreleased]: https://github.com/dolevhayut/Employee001/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/dolevhayut/Employee001/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/dolevhayut/Employee001/compare/v0.3.1...v0.4.0
[0.3.1]: https://github.com/dolevhayut/Employee001/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/dolevhayut/Employee001/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/dolevhayut/Employee001/compare/v0.1.3...v0.2.0
[0.1.0-rc.8]: https://github.com/dolevhayut/Employee001/compare/v0.1.0-rc.7...v0.1.0-rc.8
[0.1.0-rc.7]: https://github.com/dolevhayut/Employee001/compare/v0.1.0-rc.6...v0.1.0-rc.7
[0.1.0-rc.6]: https://github.com/dolevhayut/Employee001/compare/v0.1.0-rc.5...v0.1.0-rc.6
[0.1.0-rc.5]: https://github.com/dolevhayut/Employee001/compare/v0.1.0-rc.4...v0.1.0-rc.5
[0.1.0-rc.4]: https://github.com/dolevhayut/Employee001/compare/v0.1.0-rc.3...v0.1.0-rc.4
[0.1.0-rc.3]: https://github.com/dolevhayut/Employee001/compare/v0.1.0-rc.2...v0.1.0-rc.3
[0.1.0-rc.2]: https://github.com/dolevhayut/Employee001/compare/v0.1.0-rc.1...v0.1.0-rc.2
[0.1.0-rc.1]: https://github.com/dolevhayut/Employee001/compare/v0.1.0...v0.1.0-rc.1
[0.1.0]: https://github.com/dolevhayut/Employee001/releases/tag/v0.1.0
