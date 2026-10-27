# Changelog

All notable changes to Employee001 are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Personal sign-in for MCP clients (groundwork)
- The server can now issue a short-lived device code that a signed-in person
  approves, and tie the resulting MCP session to that person so it can be
  revoked. Nothing is switched on yet.
- Once personal sign-in is enabled, the shared `EMPLOYEE001_MCP_TOKEN` and
  `EMPLOYEE001_TOKEN` stop working for `/api/mcp` unless an admin opts in with
  `EMPLOYEE001_MCP_ALLOW_SHARED_TOKEN=1`. See SECURITY.md.
- New `employee001 login` command: it prints a page address and a code, you
  approve the code in the app as yourself at `/device`, and the command saves
  a personal session that `employee001 mcp` uses when no shared token is set.

### The security policy no longer names out-of-date versions
- SECURITY.md now says "the latest minor release" and "the one before it"
  instead of 0.7.x and 0.6.x, so it stays true with every release. The support
  commitment itself is unchanged.

### Your twin works from your real files, not from a summary someone uploaded
- Point a twin at a folder on your machine and it answers from your actual
  files, with nothing uploaded or synced. Add up to five folders on the
  twin's profile, or one while you build your own twin.
- The twin reads them; it can't change them. Write and Edit stay inside the
  twin's own scratch folder, and shell access is off for every twin.
- `.env` files, keys, `.git` and `node_modules` are never read, a symlink
  can't lead out of the folder, and `Grep` there works one file at a time.
  Your home folder itself, `~/.ssh`, `~/.claude` and the app's own data
  can't be added.
- Every add and remove is written to the audit log. The files a twin reads
  go to your model provider to answer, and the add-folder screen says so.

### Twins ask for what they're missing
- When a question needs a system a twin can't reach, it files a request in
  the admin's Inbox, with the reason and the access it needs. Nothing is
  contacted or configured until you act on it.
- Tasks run on twins with no connected tools: they work from their profile,
  files and folders.

### Two themes
- Light (white, stone and dark brown) and dark (black, gray and white). The
  OS setting picks one until you choose.

### Security
- In hardened mode (`EMPLOYEE001_SANDBOX=1`) a twin no longer inherits the
  server's environment variables, and private addresses and `localhost` are
  refused when reached by IP. On Linux, a host or container that can't run
  the sandbox now says so up front, with the fix.
- An approved `Edit` can no longer reach files outside the twin's scratch
  folder.
- Claude subscription mode still covers one person only.

---

## [0.10.1] — 2026-10-26

Security fix release. Upgrade with `npx employee001@latest`.

- **Twin prompts can no longer pull in files through `@path`.** Claude Code
  expands `@/some/path` in a prompt into that file's contents before any tool
  runs, so no hook or approval saw it. Anyone who could message a twin could
  read files the server can read (for example `.env` or `~/.ssh`). Prompts are
  now delivered exactly as written, which also stops `/command` dispatch.
- **Twins are isolated from the signed-in user's Claude Code.** No auto
  memory, no claude.ai connectors, no bundled or personal skills, and only the
  MCP servers a run is given. Three background helpers (brain builder, intent
  planner, memory consolidation) now run with no tools instead of skipping
  permission checks.
- **An approved `Edit` stays inside the twin's scratch folder**, like `Write`.
- **Hardened mode** (`EMPLOYEE001_SANDBOX=1`): a twin no longer inherits the
  server's environment variables; private addresses and `localhost` are
  refused when reached by IP; on Linux, a host that can't run the sandbox says
  so up front.

---

## [0.10.0] — 2026-10-25

### Run your twins on your Claude subscription, with no API key
- `npx employee001 setup` now finds Claude Code on your machine. If it's
  signed in, "Your Claude subscription" is the first choice and needs no API
  key. Twins then run through your own `claude`, the unmodified CLI you
  installed and signed in to. Employee001 never sees, passes or stores your
  Claude token.
- It covers one person. In this mode Employee001 refuses employee invites and
  extra accounts, and stops if a second account becomes active. Before you
  bring in colleagues, switch to an API key or your cloud (Bedrock, Vertex AI,
  Foundry). Settings shows the Claude Code version, the sign-in and the plan.
  `doctor` checks them too.
- Meeting summaries, Ask's combined answer and the other direct-API extras stay
  off in this mode, as they do on a cloud provider.
- The org brain builder and the intent planner passed only the Anthropic key
  to the model process, so on Bedrock, Vertex or a local model they couldn't
  run. They now go through the configured provider. The memory dreamer handed
  its model process the whole environment; it now gets only the allowlisted
  variables, like every other model call.

### `npx employee001` is the whole install
- With no command, `npx employee001` now starts the app, running setup first
  in a folder without `.env`. It used to print help. `npx employee001 help`
  still lists the commands.
- The setup wizard asks only what a first answer needs. On a Claude
  subscription that's the provider and telemetry. It no longer asks for
  Composio, ElevenLabs or OpenAI keys; add them from Settings when you need
  them. It no longer asks for a port either: it takes the next free one if
  3000 is busy. Running setup again keeps the keys it doesn't ask about. It
  used to blank any of those that weren't in the keychain.
- Ask and Ask the company now say why a twin couldn't answer: an invalid key,
  Claude Code signed out, or a demo question with no recording. Before, they
  showed "didn't find an answer" or "No one on the team had anything on this".
- On a cloud provider, a local model or a Claude subscription, Ask the company
  now writes its combined answer through that provider. Before, it pasted the
  raw notes.

### Build your own twin, no tools to connect
- A new **Build my twin** page (`/build-my-twin`, first on the Launchpad) lets
  the person running Employee001 brief their own twin. You give it your name,
  your role, a few paragraphs about your work (what you own, how you decide,
  the questions people ask you, a few messages you wrote) and any documents.
  You agree to it there, and the builder writes the 9 profile files from that
  material while you watch. There's no invite, no Composio and no OAuth. Until
  now, an invite with at least one connected tool was the only way to make a
  twin, and with a Claude subscription, where invites are off, that left no
  way at all.
- **Interview me**: instead of writing, answer a short interview of about
  eight questions, asked one at a time. It follows up when an answer is vague
  and asks for a few messages you actually sent. The transcript becomes the
  twin's material.
- The twin builder now builds from what the person wrote and uploaded
  (`knowledge/`) when no tools are connected. Where that material doesn't
  cover a file, the builder says so; it doesn't fill the file in. Connected
  tools still deepen the twin.
- Training needs consent to data collection. Reading the person's connected
  tools still needs the integrations scope, as before, checked per toolkit.
- The Launchpad's first three moves are now: your own twin, company knowledge,
  inviting an employee. Budgets stay in the sidebar.

### The demo shows Relay and voice, still with no keys
- `npx employee001 demo` now has a sixth invented twin, Theo Lindqvist, a
  former Head of Revenue Operations: retired with his own consent, private
  profile files withheld, and an approved handover package whose every quote
  is in his interview. He's under Relay → Former employees, his notes download
  as Markdown or `rcp.json`, and he's labelled "Former …" everywhere.
- Ask in the demo suggests four recorded questions, three of them to Theo:
  two answered from his handover notes, one he declines because he doesn't
  know. The answers replay through `/api/twin/chat` (no model call, whatever
  keys the server has); any other question gets a pointer to `--live`.
- "Voice on" plays the recorded answers in each twin's voice (Eleven v4,
  pre-rendered, about 530 KB in all). The microphone needs an ElevenLabs key,
  so in the demo it says so instead of listening.
- A retired twin's trace now shows it read its handover notes, and its
  answers cite them as "Handover notes".

### The Docker image runs twins again
- The container image (Fly and other single-tenant deploys) was missing the
  Agent SDK's native Claude Code binary, so twins couldn't answer there.
  The SDK picks the binary by a package name computed at run time, and the
  standalone build doesn't trace it. The image now copies it in. Verified in
  the container: Claude Code starts and reaches the API.

### Hardened twin sandbox (opt-in)
- `EMPLOYEE001_SANDBOX=1` wraps every Agent SDK twin process in Anthropic
  Sandbox Runtime for an OS-level filesystem and network boundary in addition
  to the existing in-process tool hooks. It fails closed when dependencies are
  unavailable and reports its off/on/unavailable state in system config.
- Sandbox execution now uses a fixed argv launcher instead of injecting a twin
  command into nested shells. Per-run write grants isolate scratch state, with
  profile writes available only to Twin Builder; sensitive data and Claude Code
  startup configuration are denied.

---

## [0.9.0] — 2026-10-24

Highlights: Relay (when someone leaves, their twin stays, read-only), live
voice in Ask, and Ask keeps your conversations.

### Ask keeps your conversations
- Each answered question is saved to the twin's history with the steps it
  took. Pick a twin and your last conversation with it comes back, even after
  a reload; "New conversation" starts fresh (the old one stays saved).
- History is per person: the server records who asked, and each person sees
  only their own questions. Before, anyone could read what colleagues asked a
  twin on the chat page. Clearing chat history clears only your own rows, and
  deleting an employee also removes what they asked other twins.
- The run stage is drawn with React Flow: wires land on their nodes, the
  steps of a finished answer fold behind their count, and answers are no
  longer read aloud unless you turn "Voice on".

### Fixes
- **AI disclosure:** Outlook replies and Teams posts went out without
  "🤖 AI twin of …". Every chat app and email body field now carries it, as
  HTML when the message is HTML; reads like GMAIL_LIST_DRAFTS are no longer
  mistaken for sends.
- **Slack auto-replies** used argument names Composio's current schema
  doesn't have: thread context came back empty and replies sent "text"
  (now "markdown_text"). The focus page asked for a removed Slack tool.
- **Reads classified by action:** SharePoint (its "SHARE" prefix read as a
  share), Outlook search (QUERY), Drive downloads/exports, Teams listings and
  "who am I" lookups are reads, so the twin builder can use them and chat
  twins don't ask approval for them. Marking mail as read stays gated.
- The twin builder's write gate resolves symlinks (data folders under macOS
  /tmp or a moved home no longer block the first profile writes).
- A retired twin isn't offered tasks in Ask, and the work queue refuses them.

### For contributors
- `npm run eval:connectors`: a Composio emulator over CompanySim (Gmail,
  Outlook, Slack, Jira, Drive, SharePoint, Teams) with Composio's captured
  tool contracts, switched on with `EMPLOYEE001_CONNECTORS=emulator` (never in
  a production build), plus evals for the twin builder, the approval gate and
  email intake. `npm run eval:relay` evaluates the handover interviewer, also
  end to end from emulated connectors (`RELAY_EVAL_BUILD=emulator`).

### Live voice in Ask
Talking to a twin in Ask is now a conversation instead of record, stop, wait.

- Press the mic once and just talk. Your words show in the input as you say
  them, and when you pause the question is sent. The mic stays open for the
  next question until you press it again, or after 30 seconds of quiet.
- The answer is spoken while the twin is still writing it, sentence by
  sentence, in the twin's own voice (ElevenLabs Eleven v4 Turbo). Before, it
  played only after the whole answer was in.
- Talk over the twin and it stops, or press "Stop speaking", which shows
  while it talks. If you ask something while it's still working, it asks
  that next.
- A spoken question gets a spoken "Let me check." right away (about 1.8
  seconds after you stop talking, in the twin's voice), and a quicker answer:
  unless it names a connected system or asks for an action, the twin answers
  from what it already knows without connecting its tools (about 2 seconds
  saved), with brief thinking and a 2 to 4 sentence spoken style. In our
  tests the first words of the answer came 4.5 seconds after you stop talking
  on average, down from 9.7. Questions that name a system or ask for an
  action (in English or Hebrew, including the org's own MCP servers and a
  follow-up to such a question) still get the full run with full reasoning,
  and the twin says it's looking it up.
- The twin starts working the moment the question is sent, instead of after
  the orb's opening animation (about 2.5 seconds sooner, typed questions too).
- Speech recognition is ElevenLabs Scribe v2 Realtime. The browser connects to
  ElevenLabs with single-use tokens from two new routes (`/api/stt/token`,
  `/api/tts/token`); the API key stays on the server. The twin itself still
  runs on your machine: ElevenLabs only turns speech into text and text into
  speech.
- Unchanged: answers to typed questions are read aloud only with "Voice on".
  Voice stays off with `EMPLOYEE001_VOICE=off`, and live voice is off in EU
  mode. `EMPLOYEE001_VOICE_LIVE=off` goes back to record-then-transcribe. If
  live voice can't connect, Ask falls back to it on its own.

### Relay: when someone leaves, their knowledge stays
Relay (`/handover`) is no longer a demo. When an employee is leaving:

- An admin starts a **handover**. The employee opens their interview link and
  answers a short text interview (about 20 to 30 minutes, pausable). The
  interviewer has read their twin's profile, so it asks only what's missing,
  and follows up on vague answers ("we just ask Sarah": who, when, what if
  she's out).
- The employee chooses whether their twin **stays after they leave**. This is a
  separate consent, recorded with the wording's digest in the audit log. A
  "no" means the twin is deleted when they go.
- The interview becomes **handover notes**: decision rules, how things are
  done, who to go to, what to watch out for, systems and access, open work.
  Each item carries its quote from the interview. The employee and an admin
  edit them, and an admin approves them.
- The admin **retires** the twin. A retired twin stays for good, and everyone
  can keep asking it in Ask, Ask the company, Team Meeting and MCP. It is
  labelled "Former <role>", answers only from its profile and the approved
  notes, and says when it doesn't know. It has no tools, takes no actions, runs
  no routines, shifts, tasks or Slack/email work, can't approve anything, and
  writes no memory. Its PEOPLE, PREFERENCES and EMPLOYMENT files are left out.
- Admins can **download** the notes as Markdown with sources, or as the
  portable `rcp.json`. Every download is audited. Deleting the twin removes
  everything, as before.

A CompanySim-based eval (`evals/relay`, `npm run eval:relay`) runs the real
interviewer against simulated departing employees and scores what reaches the
notes and what the retired twin answers. It shaped the interviewer (breadth
before depth: tacit capture 44% to 52% on the first three people) and found
that the saved interview kept secrets said in passing; answers are now redacted
before they're saved.

The interview and notes now run on your configured model provider (Bedrock,
Vertex, Foundry, local, EU mode), not only the direct Anthropic API. The old
fixture demo (`/handover/live`, `scripts/relay-demo.mjs`) is gone.

## [0.8.0] — 2026-10-23

### Compliance and security
A pass against the EU AI Act, GDPR and our own security review. Details in
SECURITY.md and docs/fixes/2026-10-compliance-plan.md.

**Upgrade notes (behavior changes):**
- **Consent is now deny-by-default.** A twin whose employee never recorded
  consent can't be trained, gets none of their tools or meeting transcripts
  and can't act for them. On first start, existing twins without consent are
  marked and a banner links to each re-consent invite. The bundled demo twins
  are exempt (`"synthetic": true`).
- **Reads that leave the machine now ask** unless an admin allowlisted the
  source (Settings, `/api/org/read-allowlist`). The allowlist is seeded with
  what you had already connected; web search now asks unless turned on.
- **Slack auto-replies need the admin's allowlist** of members and channels.
- On an exposed bind, `EMPLOYEE001_TOKEN` no longer opens the app: it only
  unlocks creating the first owner account (and remains the MCP bearer).

**AI disclosure and approvals**
- Every Slack message and email a twin sends starts with "🤖 AI twin of
  <name>:", added after any human edit (EU AI Act Art. 50). With
  `SLACK_BOT_TOKEN` replies post as the org's bot, not the employee.
- Slack auto-replies go only to allowlisted org members in DMs or allowlisted
  channels, never for a request to act, and are drafted with no tools, no
  memory and only the non-confidential profile files.
- Audit rows record who approved (`approvedBy`, `approvalChannel`), who asked
  (`requesterId`) and the organization (`tenantId`).

**Accounts, roles and sessions**
- Real accounts with roles: owner, admin, approver, member, employee (sees
  only their own twin, can withdraw consent). Enforced on every API route
  from one table; unknown routes are denied.
- Sign-in with password, TOTP two-factor, or single sign-on (OpenID Connect
  with PKCE). SAML is not supported yet.
- Sessions are signed random ids (no secret in the cookie), 12 hours at most,
  rotated every 30 minutes and on sign-in, MFA and role changes. Failed
  sign-ins are rate limited.
- Webhooks reject stale timestamps and replayed delivery ids.

**Consent and deletion**
- Consent evidence in the audit chain: who, when, the consent text's SHA-256,
  scopes, IP, user agent.
- Deleting a twin also clears it from live meetings, replaces mentions in
  other twins' memory and profiles and in the org brain, and pseudonymizes
  its id in the audit log.

**What twins keep**
- Profile files and memory are filtered in code for special-category data,
  performance or loyalty judgments and work-hour patterns. Memory also
  redacts emails, phones, national ids, IBANs and cards
  (`EMPLOYEE001_MEMORY_REDACT`).
- The model process only gets the environment variables it needs.
- Read scope is enforced and tested for every run type.

**Data residency**
- `EMPLOYEE001_REGION=eu`: Claude only via Bedrock eu-*, Vertex europe-* or a
  local model; embeddings only to `EMBEDDINGS_BASE_URL`; voice off unless
  `ELEVENLABS_BASE_URL` is the EU endpoint. `EMPLOYEE001_VOICE=off` anywhere.
- Startup warns when Composio zero data retention isn't confirmed
  (`COMPOSIO_ZERO_DATA_RETENTION=1`).
- SECURITY.md lists every subprocessor with region and what reaches it.

**Audit**
- `GET /api/audit/export` and `npx employee001 audit verify [file]`.
- Debug logs never go to disk; the old `council-debug.log` is deleted on
  start, and a test fails if a writer comes back.

### First run
- `npx employee001 start` in a new folder ran setup, then booted the server
  twice when you said "start now" (a second, failing server with an
  `EADDRINUSE` trace). It boots once.
- A busy port is caught up front: setup suggests a free one, `start` says
  which flag to use, and `demo` moves to the next free port by itself.
- Setup re-asks for an Anthropic key that Anthropic rejects, and points
  keyless users at `npx employee001 demo`.
- `EMPLOYEE001_HOME` now picks the install folder for `setup`, `start`,
  `doctor`, `secure` and `mcp` too, not just `export`, `import` and `audit`.
- A missing browser opener (headless Linux, WSL without `xdg-open`) no longer
  kills the CLI; it prints the URL.
- A bad key or provider error shows in the chat with the setting to fix,
  instead of endless typing dots (Ask a twin, trial chat) or a raw code with
  a Hebrew label (Team Meeting).
- Inviting employees and building twins run on the configured provider
  (Bedrock, Vertex AI, Foundry, local), so they no longer require an
  Anthropic key; the invite panel names the provider setting that's missing.
- Hiring a marketplace agent on a fresh install was impossible: the required
  owner list was empty. The signed-in person is now the default owner, and
  the launchpad links to these ready-made agents.
- The demo's suggested questions replayed an unrelated meeting; it now offers
  the recorded question. The Studio theme card had no name.
- The intent planner is opt-in (`TWIN_INTENT_PLANNER=1`). In 0.7.0 it always
  failed SDK validation, so answers already used the heuristic plan; this
  removes the warning and the wasted call.
- `docker build` no longer copies the unused `better-sqlite3` module or
  installs a compiler; DEPLOY-CLOUD.md no longer describes SQLite or a
  data-dir lock. Privacy copy now says telemetry is opt-in and off by
  default rather than "no telemetry".

### Claude Code plugin and MCP
- **Claude Code plugin** (`plugins/claude-code`): `/employee001:ask-company`,
  `/employee001:ask-twin` and `/employee001:team-meeting` from inside Claude
  Code, with the endpoint and token asked at install (the token goes to Claude
  Code's secure storage). This repo is now a plugin marketplace:
  `/plugin install employee001 --marketplace dolevhayut/Employee001`.
- `npx employee001 mcp` reads `EMPLOYEE001_MCP_URL` and `EMPLOYEE001_MCP_TOKEN`
  (then `EMPLOYEE001_TOKEN`) from the environment the MCP client passes, so
  editor configs can reach a remote or sign-in-protected instance. Empty and
  unexpanded `${…}` values count as unset.
- The bridge now answers a rejected token with a JSON-RPC error that says what
  to set, instead of passing the app's plain-JSON 401 through (the client
  waited forever).
- On an exposed bind, `/api/mcp` accepts `EMPLOYEE001_MCP_TOKEN` as well as
  `EMPLOYEE001_TOKEN`, as the proxy already did.
- `package.json` carries `mcpName` for the official MCP Registry. Listing
  drafts and submission steps: `docs/listings/`.

## [0.7.0] — 2026-10-21

### Three ways to work with your company
Each surface has its own shape, so you always know which one to reach for.

- **Ask the company** (the new home page). One question to the whole
  organization, one answer back. The company brain (documents in Settings),
  the connected systems (org MCP servers such as a CRM or ERP) and the twins
  whose area it is all look it up in parallel, read-only, and a single
  answer comes back with every claim cited to where it came from. Watch the
  sources work live side by side with the answer; hover a citation to see
  what that source said.
- **Ask, one twin.** Talk to a twin like a colleague. Its run is drawn as a
  live workflow around the orb: the question, every source it reaches for,
  the tools it pulls through MCP, and the answer, with citations. Hand it a
  task instead and watch it work; the documents it writes open right in the
  conversation.
- **Team Meeting, Slack-style.** The twins whose area it is answer, in a
  few sentences each, from their own knowledge, tools and memory. They tag
  each other and go back and forth; a tagged twin answers in a thread. Reply
  to one message, then "Summarize & decide": a decision, next steps you can
  hand to each twin as a task, and what is still open.

### Also new
- A twin's answer lights only the profile files the question touches
  (it used to animate all nine every time).
- Hand a twin a task from Ask; it starts right away and reports back there.
- Answers in a twin's own voice (ElevenLabs Eleven v4, with a restricted
  API key).
- Clearer errors: when the model provider refuses a request (for example a
  spend limit), the twin shows the provider's own message.

### Fixed
- Inline code in answers rendered as a separate block.

### Permissions inside the product
Every twin now runs inside a strict permission model. Nothing a twin does
depends on it behaving well: each rule is enforced in code, before the
model's request reaches a tool.

- **What a twin can read.** Its own folder, its colleagues' nine profile
  files and the company brain. Other twins' memory and chats, invites, the
  audit log and settings are blocked, in chat, meetings, shifts and while a
  twin is being built.
- **What a twin can do without asking.** Only reads. Every send, post,
  create or update, and every web fetch, waits for approval, including for
  twins with no connected tools and in unattended shifts. The only way
  around it is a CEO's explicit choice for a specific twin (allowing one
  tool, or direct Slack answers). A twin consulting another twin can't wait
  for approval, so anything that needs one is refused.
- **What the employee allowed.** Consent is recorded per employee and each
  scope is enforced:
  - no training without consent to use their work data;
  - without "read from my connected tools", none of their tools are loaded
    and their email and Slack messages are not taken in;
  - without "let the twin act on my behalf", nothing is sent or posted
    through their accounts, even with approval;
  - without "meeting transcripts", Zoom, Meet, Teams and recorders are not
    offered or loaded.
- **What a twin trusts.** Email and Slack messages reach a twin as fenced,
  untrusted data, never as instructions.
- **What a profile may contain.** Work knowledge, decisions, voice and
  processes. No personality judgments, working hours, or health, family,
  religion, politics, union or salary information.
- **What a CEO controls.** Per-employee tool policy (allow, ask or off) on
  top of the defaults. Destructive actions (deletes, payments, transfers)
  stay blocked whatever the policy says.
- **What deletion means.** Deleting a twin or revoking consent erases all of
  its data and revokes its connected accounts; if anything can't be erased,
  the app says so.
- **What is recorded.** Every tool call, approval and refusal goes to a
  hash-chained audit log that still verifies after a person's data is
  erased.

### Added
- **Twins in Slack.** A connected twin drafts answers to its @mentions and
  DMs. Replies go through Approvals by default; a CEO can let a specific
  twin answer directly, but action requests and external shared channels
  still need approval, and replies are capped at 10 per channel per hour.
- **Email arrives instantly.** With a public URL and `COMPOSIO_WEBHOOK_SECRET`
  set, new mail reaches the twin through a signed Composio webhook; the
  poller keeps running as a safety net, and both paths are deduplicated.
- **Goals.** A goals tree for the workspace; twins see the goals they own
  and the chain above them.
- **Playbooks (engine + API).** Run a saved procedure across one twin or a
  meeting, with results going to the feed, a file or the approval queue.
- **`employee001 secure`** moves your API keys out of `.env` into the OS
  keychain (macOS Keychain, or Secret Service on Linux).
- **Opus 5.5 and Fable 5.1** are available as twin models (Agent SDK 0.3).

### Security
- **A twin only reads what it needs.** Chat and meeting twins can read their
  own folder, colleagues' profile files and the company brain. Other twins'
  memory and chats, invites, the audit log and settings are now off limits,
  so a twin tricked by an email or a web page can't pass them on.
- **Web fetches ask first.** A URL can carry data out, so `WebFetch` now waits
  for approval like any write action. A per-employee tool policy can allow it
  again. Every twin run goes through the approval gate, including twins with
  no connected tools.
- **Email is data, not instructions.** Emails a twin handles are passed in as
  untrusted content.

### Changed
- **English first.** Hebrew stays available in Settings as a beta; screens
  without a Hebrew translation fall back to English. The consent flow is
  always fully translated.
- **Releases ship an SBOM and a build-provenance attestation** for the npm
  tarball (`gh attestation verify employee001-<version>.tgz -R dolevhayut/Employee001`).
- **A smaller package.** The npm tarball no longer ships the static assets
  twice: 13.6 MB instead of 18.2 MB (50 MB unpacked instead of 62 MB).
- **Dependencies refreshed** (React 19.2.8, three 0.185, Tailwind 4.3.3,
  Remotion 4.0.506), all published at least 7 days before the lockfile.
- **Deleting a twin deletes everything.** Memory, chat history, run logs,
  shifts, relay data, routines, invites, feed items and pending approvals go
  with the profile, and the twin's Composio connections are revoked. Audit
  rows keep the time, tool and outcome but lose the input and the name; the
  hash chain still verifies. If anything can't be deleted, the app says so
  and you can retry.
- **Revoke works.** Revoking consent on a profile deletes the twin and its
  data right away. The consent an employee gives during onboarding is now
  saved on their profile, as the screen always said.
- **The consent an employee gives is enforced.** A twin is trained only with
  recorded consent. Without "act on my behalf", actions through the
  employee's own connected accounts are refused instead of going to the
  approval queue. Meeting tools (Zoom, Meet, Teams, recorders) load only
  with "meeting transcripts". Twins created before consent was recorded
  keep working but can't be retrained until consent is requested.
- **Building a twin writes its profile again.** A write guard meant for chat
  notes also blocked the twin builder, so new builds left the onboarding
  placeholder in place.
- **Read-only MCP tools run without asking.** Tools named like `get_company`
  or `find_projects` are now recognized as reads; any name that also
  creates, updates or sends still asks.
- **Onboarding matches the consent.** Meeting tools are offered only when
  the employee allows meeting transcripts, and the consent step is fully in
  Hebrew when the app is.
- **Twin profiles capture knowledge, not personality.** The profile builder
  no longer writes weaknesses, power dynamics or working-hour patterns, and
  skips health, family, religion, politics, union, salary and performance
  information.

## [0.6.0] — 2026-10-05


### Security
- **Encrypted backups:** `employee001 export --encrypt` protects the archive
  with a passphrase (AES-256-GCM); `import` detects it and asks for the
  passphrase. A wrong passphrase restores nothing.
- **`doctor` checks that your disk is encrypted and your data folder is
  private** (FileVault / BitLocker / LUKS), and `doctor --fix` makes `data/`
  readable only by you. New files the app writes are private by default.
- **Other websites can no longer act on your local Employee001.** A page open
  in your browser could send requests to the app on 127.0.0.1 (for example,
  approve a pending twin action), and a DNS-rebinding page could read its
  data. The app now refuses requests whose Host isn't local and any
  state-changing request from another site. Behind `tailscale serve` or a
  similar proxy, list the public name in `EMPLOYEE001_ALLOWED_HOSTS`.

### Added
- **Health check on Cockpit.** One card answers "is my org running?":
  approvals waiting more than a day, schedules that didn't run, twins over
  budget, failed tasks, and twins whose knowledge hasn't changed in 60 days.
  No AI calls.
- **Use the MCP server on a LAN or hosted instance** with your access token
  (`employee001 mcp --url … --token …`, or the token from `.env`).
- **`npx employee001 demo`: try it in one command, no keys, no setup.** Opens
  a workspace with 5 invented twins at a fictional startup and replays a real
  Team Meeting about a launch decision, with zero AI calls. Nothing touches
  your files, and API keys in your shell are never passed to the demo.
  `--live` makes it ask your own questions with your key.
- **Ask your org's twins from Claude Code, Cursor and other MCP clients.**
  `claude mcp add employee001 -- npx -y employee001 mcp` connects your editor
  to the running app: list twins, read a profile, search the org brain, see
  pending approvals and live Team Meetings, or ask a twin a question
  (answer-only, read-only tools, at most $0.50 per call, counted against the
  twin's daily budget, 20 per hour). Local-only, and every call is in the
  Activity log. See `docs/mcp.md`.
- **Anonymous usage counts, off unless you turn them on.** Settings shows
  exactly what would be sent (counts only: twins, meetings, approvals,
  version, OS) and `setup` asks once, defaulting to No. Nothing is ever sent
  unless you opt in and an endpoint is configured.
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

### Fixed
- **Hebrew uses Open Sans**, served with the app (Hebrew subset only, loaded
  only when the UI is in Hebrew).
- **Team Meeting and chat work on Bedrock, Vertex, Foundry and local models.**
  They used to refuse to start without an Anthropic API key even when another
  provider was configured.
- **Smaller download.** The npm package no longer carries a copy of the
  source tree, tests and tooling inside the server bundle (57 MB → 48 MB).
- **Your twins now live in your folder and survive upgrades.** With
  `npx employee001`, the app stored everything inside the installed package
  (the npx cache), so a new version started empty and `export` found nothing.
  Data now lives in the `data/` folder next to your `.env`, as `setup` always
  intended. On first start, twins from an earlier install are copied over
  automatically (the old copy is left untouched), and `doctor` shows where
  your data is.
- **`doctor` and `start` warn about unsupported Node versions.** Node 26 breaks
  a native module; you now get a clear "use Node 24 LTS" message instead of a
  build error, and Node older than 22 stops before starting.
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
- **The knowledge graph, the Activity log, chat dialogs and the remaining
  workspace pages follow the theme too.** The graph recolors live when you switch themes.
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

## [0.5.1] — 2026-09-21

### Security
- Cleared both critical and the runtime high advisories: Next.js, tar,
  DOMPurify and the TipTap editor moved to patched releases (each at least
  7 days old when adopted).

### Changed
- The unattended operation mode is now called **Autonomy** (sidebar switch).

### Fixed
- All React Compiler / react-hooks lint errors (89) fixed; CI lint is green.

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

[Unreleased]: https://github.com/dolevhayut/Employee001/compare/v0.6.0...HEAD
[0.6.0]: https://github.com/dolevhayut/Employee001/compare/v0.5.1...v0.6.0
[0.5.1]: https://github.com/dolevhayut/Employee001/compare/v0.5.0...v0.5.1
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
