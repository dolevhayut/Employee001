# Employee001 for Claude Code

Ask your company's AI twins without leaving Claude Code. The plugin connects Claude Code to your own self-hosted [Employee001](https://github.com/dolevhayut/Employee001) and adds three commands:

| Command | What it does | Cost |
|---|---|---|
| `/employee001:ask-company <question>` | Searches the org brain, picks the 1–3 colleagues who own the topic, and writes one answer with each fact cited to a colleague or document. Skips the paid twin calls when the record already answers. Claude also uses it on its own when you ask what the team decided. | Free from the record; up to $0.50 per twin asked |
| `/employee001:ask-twin <colleague> <question>` | Asks one colleague's twin and shows the answer in their voice. | Up to $0.50 |
| `/employee001:team-meeting <topic> [with <names>]` | Two rounds between 2–3 twins (positions, then replies to each other), written up as minutes: agreements, disagreements, recommended decision, open questions. Only runs when you type it. | Up to $0.50 per answer, $3.00 max |

Free read tools (search, profiles, meeting transcripts) run without asking. `ask_twin`, the one that spends money, asks you for permission the first time, as any tool does.

## Requirements

- Employee001 running somewhere you can reach: `npx employee001 start` (default `http://127.0.0.1:3000`).
- Node 22 or later (the plugin starts `npx -y employee001 mcp`, a stdio bridge to the running app).
- Claude Code 2.1.275 or later for the one-line install.

## Install

```text
/plugin install employee001 --marketplace dolevhayut/Employee001
```

Or from a shell:

```bash
claude plugin marketplace add dolevhayut/Employee001
```

```bash
claude plugin install employee001@employee001
```

The install asks for two optional settings:

- **Employee001 MCP endpoint.** Keep `http://127.0.0.1:3000/api/mcp` for a local install. Change it for another port, a LAN machine or a Fly instance.
- **MCP token.** Leave it empty for a plain local install. Set it once sign-in is on, or for a remote instance: the value of `EMPLOYEE001_MCP_TOKEN` (or `EMPLOYEE001_TOKEN`) from that instance's `.env`. Claude Code keeps it in its secure storage, not in settings files, and is sent only as an HTTP Bearer header.

Change them later with `/plugin configure employee001@employee001`. From a shell: `claude plugin install employee001@employee001 --config url=https://e001.example.com/api/mcp --config token=…`.

## Try it

```text
/employee001:ask-twin Noa What is our rule for shipping database migrations?
/employee001:ask-company Who owns enterprise onboarding?
/employee001:team-meeting Should the bank pilot be 60 or 90 days? with Shira and Daniel
```

No twins yet? `npx employee001 demo --live` starts six invented twins on port 3100. Point the plugin's endpoint at `http://127.0.0.1:3100/api/mcp`.

## What leaves your machine

The plugin sends your question, plus a line of context Claude picks from the search results, to your Employee001 instance. Employee001 runs the twin with the model provider you configured. Nothing goes to any other server. Every MCP call is written to Employee001's audit log.

## Troubleshooting

- **"Employee001 is not running".** Start it (`npx employee001 start`) or fix the endpoint with `/plugin configure employee001@employee001`.
- **"missing or invalid token" / "unauthorized".** Sign-in is on or the instance is remote: set the MCP token. Token support in the bridge needs an Employee001 release newer than 0.7.0 on the machine running Claude Code (`npx -y employee001@latest help` once refreshes the npx cache).
- **The server shows as failed in `/mcp`.** The first `npx -y employee001` downloads the package (about 50 MB), which can outlast the MCP startup timeout. Run `npx -y employee001 help` once, then `/reload-plugins`.
- **`ask_twin` missing.** The instance was started with `EMPLOYEE001_MCP_ASK_TWIN=off`. The commands still answer from the record.

Full MCP reference: [docs/mcp.md](../../docs/mcp.md).

## Develop the plugin

```bash
claude plugin validate plugins/claude-code --strict
```

```bash
claude --plugin-dir plugins/claude-code
```

Edit a skill, then run `/reload-plugins`. Tool names inside skills use the plugin form `mcp__plugin_employee001_employee001__<tool>`.
