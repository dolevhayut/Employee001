# Employee001

> Your company's organizational brain — agent twins of your real employees, running entirely on **your own machine**.

[![npm version](https://img.shields.io/npm/v/employee001)](https://www.npmjs.com/package/employee001)
[![npm downloads](https://img.shields.io/npm/dm/employee001)](https://www.npmjs.com/package/employee001)
[![CI](https://github.com/dolevhayut/Employee001/actions/workflows/ci.yml/badge.svg)](https://github.com/dolevhayut/Employee001/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](https://nodejs.org)

| Employees roster | Twin chat | Settings |
|---|---|---|
| ![Employees](docs/screenshots/02-employees.png) | ![Twin chat](docs/screenshots/03-flow.png) | ![Settings](docs/screenshots/04-settings.png) |

## Install

```bash
npx employee001 setup
npx employee001 start
```

Then open <http://localhost:3000>.

Requires Node.js 22+, an Anthropic API key, and a Composio API key (for MCP tool integrations). All data stays in `./data/` on your machine. MIT licensed. No telemetry. No cloud.

## What it does

- **Agent twins for every employee** — always-on AI twins of the people who actually work at your company.
- **Twin council meetings** — ask one question, the right twins debate and converge.
- **Real tool execution** — twins draft Slack messages, file Linear tickets, send emails, push code, through Composio MCP.
- **Org Brain** — one shared knowledge graph every twin reads from.
- **On-prem by design** — runs on your Mac mini (or any machine with Node 22). Bound to `127.0.0.1` by default.
- **Human-controlled autonomy** — every sensitive action hits an approval gate before it runs.

## Why not ChatGPT Teams or Copilot?

Those tools give your employees AI. Employee001 gives your company AI — twins that represent specific people, carry institutional knowledge, and can act on your behalf through real tools.

The bigger difference: **your data never leaves your machine.** ChatGPT Teams and Copilot send every conversation to OpenAI or Microsoft. Employee001 sends only the prompts you explicitly generate to Anthropic. Employee profiles, org knowledge, audit logs — all stay on your hardware.

This matters if you're a law firm, a fund, an agency, or any team where client confidentiality isn't optional.

## How it works

```mermaid
flowchart LR
    CEO["CEO (browser)"]
    subgraph local ["Your machine"]
        Server["employee001 server\n(Next.js + Node)"]
        Data["data/\nprofiles · audit · knowledge"]
        Server <--> Data
    end
    Anthropic["Anthropic API\n(Claude)"]
    Composio["Composio MCP\n(tools)"]

    CEO -->|invite link| Server
    CEO -->|ask a question| Server
    Server -->|prompts only| Anthropic
    Anthropic -->|twin responses| Server
    Server -->|tool calls| Composio
    Composio -->|Slack · Linear · email · code| Server
    Server -->|answer + approval gate| CEO
```

Data flow in plain English:
1. **CEO invites employees** — each employee fills a profile form, saved as a markdown file in `data/employees/`
2. **CEO asks a question** — routed to one or more twins based on expertise
3. **Twin(s) reason** — using Claude, reading from `data/` knowledge graph
4. **Tool calls** — if a twin wants to send a Slack message, file a ticket, etc., it goes through Composio MCP; CEO approves before execution
5. **Nothing persists outside `data/`** — no external database, no analytics

## Commands

| Command | What it does |
|---|---|
| `npx employee001 setup` | Interactive first-run wizard. Writes `.env`, creates `data/`. |
| `npx employee001 start` | Starts the local server. Opens browser. |
| `npx employee001 update` | Checks GitHub releases for a newer version. |
| `npx employee001 doctor` | Health check — Node version, env, API keys, port. |
| `npx employee001 help` | Show help. |

Flags for `start`:
- `--no-open` — don't open the browser
- `--port <n>` — override the port

## Where your data lives

```
./
├── .env          # your API keys (chmod 600)
└── data/
    ├── employees/        # markdown profile files per twin
    ├── audit.jsonl       # every tool call, every approval
    ├── routines.json     # scheduled work
    ├── hired-agents.json # marketplace hires
    └── task-history.jsonl
```

Nothing in `data/` is ever sent anywhere except to the Anthropic API (only the prompts that twins generate when you ask them to do work). No telemetry. No analytics. No "phone home".

## Network exposure

By default, the server binds to `127.0.0.1` — only this machine can reach it, and the OS itself is the access boundary.

To expose on your LAN (e.g., for a Mac mini in the office serving the whole team):

```bash
EMPLOYEE001_BIND=0.0.0.0 npx employee001 start
```

When bound to anything other than `127.0.0.1`, every request must carry a shared-secret token. `npx employee001 setup` generates one (`EMPLOYEE001_TOKEN` in `.env`) automatically. `start` prints the access URL on boot — visit it once from each device on your LAN:

```
http://<mac-mini>:3000/?token=<your-token>
```

The token is then set as an `e001_token` httpOnly cookie for 30 days. API calls without a matching cookie return `401`.

> **Still: use a firewall or Tailscale.** The token gates HTTP access, but the app itself is not hardened for the public internet. Don't put this on a port-forwarded box.

To rotate the token, delete the line from `.env` and re-run `setup`.

## What twins are allowed to do

Twins run on the [Claude Agent SDK](https://docs.claude.com/en/api/agent-sdk/overview). The SDK gives them access to tools — file reading, web search, calling external services through Composio MCP, and so on. We don't enable everything. The permissions are deliberate and the same for every twin in every workspace.

**Hard-disallowed everywhere — no twin can call these, ever:**

```
Bash · NotebookEdit · EnterWorktree · ExitWorktree
```

No twin can run a shell command on your machine. No twin can edit notebooks. No twin can spawn or move between git worktrees. This is enforced in two places at once (the SDK's `disallowedTools` strips them from the model's context, and a `PreToolUse` hook rejects them defensively if a future config ever lets them through).

**What's allowed, by run type:**

| Run type | Built-in tools | External tools |
|---|---|---|
| **Twin chat** (you ask a twin a question) | `Read`, `Glob`, `Grep`, `Write`¹, `WebSearch`, `WebFetch`, `Task`², `TodoWrite`, `AskUserQuestion` | Composio³ |
| **Twin training** (autonomous profile build) | `Read`, `Write`¹, `Glob`, `Grep`, `TodoWrite` | Composio³ (read-only signal — Slack/Gmail/Linear/GitHub history) |
| **Scheduled routines** (e.g. daily PR digest) | `TodoWrite` | Composio³ |
| **Org-brain summarisation** | — none — | — none — |

¹ `Write` is sandboxed to `data/scratch/<employee-id>/`. A twin can jot a memo or draft — it **cannot** overwrite its own profile, the org brain, audit logs, or any other file under `data/`. Path traversal is rejected.

² `Task` spawns one of two restricted sub-agents: a **web-researcher** (only `WebSearch` + `WebFetch`) or a **brain-explorer** (only `Read` + `Glob` + `Grep`). Sub-agents inherit the same hard-disallow list.

³ Composio MCP tools are *external-effect* tools — posting to Slack, sending Gmail, opening GitHub PRs. Every call hits the **approval gate**: the twin proposes the action, you see it in the approval queue with the full input, you click **Approve** or **Deny**. Auto-execution is off by default. Read-only Composio calls (listing channels, fetching messages, reading PRs) run without prompting — they don't change anything outside.

**Audit trail.** Every tool call — built-in or Composio — is appended to `data/audit.jsonl` with the run id, the employee id, the tool name, the input, and the verdict (`executed` / `ceo_approved` / `ceo_denied` / `hard_blocked`). Browseable from `/audit` in the workspace.

**Web citations.** After any `WebSearch` or `WebFetch`, a `PostToolUse` hook injects an instruction into the model's context telling it to cite the URL and the fetch date in its answer. Twins can look things up online, but they can't pretend they "just knew" something.

**Models.** Twins use `claude-sonnet-4-6` by default with `claude-sonnet-4-5` as a fallback. You can override to `claude-opus-4-7` for a single message from the chat UI. Twin-training runs use `effort: high`; routines use `effort: low`; everything else uses `effort: medium`. Adaptive thinking is on.

If you want to see the source of truth, it's all in [`src/lib/sdk-defaults.ts`](src/lib/sdk-defaults.ts).

## Open-core

100% of the code in this repo is MIT-licensed and free. Everything you see in the product is available to you.

**Premium = services**, not features:
- Professional onboarding (we install it for you, set up MCP connections, train your team)
- SLA support with dedicated Slack channel
- Custom integrations

If that's interesting, [open a discussion](https://github.com/dolevhayut/Employee001/discussions) or email office@bulldog-adv.com.

## Stack

- [Next.js 16](https://nextjs.org) (App Router, RSC, standalone output)
- [Claude Agent SDK](https://www.anthropic.com) (Anthropic) for reasoning + tool use
- [Composio MCP](https://composio.dev) for tool integrations
- JSON files on disk for state (SQLite migration coming)

## Contributing

PRs welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md) for setup, the rules of the road (no telemetry, no paid gates, no cloud dependencies), and how to file a security issue.

Maintainers: see [RELEASING.md](./RELEASING.md) for the tag-driven publish flow.

## License

MIT © Dolev Hayut
