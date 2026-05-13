# Employee001

> Your company's organizational brain — agent twins of your real employees, running entirely on **your own machine**.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](https://nodejs.org)

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

By default, the server binds to `127.0.0.1` — only this machine can reach it.

To expose on your LAN (e.g., for a Mac mini in the office serving the whole team):

```bash
EMPLOYEE001_BIND=0.0.0.0 npx employee001 start
```

> **Use a firewall or Tailscale.** This app is not hardened for the public internet.

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

PRs welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md) when it lands.

## License

MIT © Dolev Hayut
