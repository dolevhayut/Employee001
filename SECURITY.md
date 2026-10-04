# Security Policy

## Supported Versions

| Version | Supported |
|---|---|
| The latest minor release (currently 0.6.x) | ✅ |
| The minor release before it (currently 0.5.x) | ✅ Security fixes only |
| Older releases | ❌ |

We support the latest minor release and the one before it as weekly releases continue.

## What leaves your machine

Employee001 keeps profiles, memory, audit logs, and org knowledge in `./data/` on the machine where you run it. The following outbound routes are configuration- or action-dependent. Run `npx employee001 doctor --egress` from your install to see the exact hosts active in your current configuration. Use `npx employee001 start --strict` to set the Claude Agent SDK's nonessential-traffic flag when starting the server.

| Destination | What is sent | When / which setting turns it on | How to turn it off |
|---|---|---|---|
| `api.anthropic.com` (or `ANTHROPIC_BASE_URL`) | Prompts and profile context | Twin chat, training, and memory distillation when `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN` is set | Remove the Anthropic credential; stop the server when it is not in use |
| Your own Claude cloud endpoint: Amazon Bedrock, Google Vertex AI, or Azure AI Foundry | Prompts and profile context | A twin runs with `CLAUDE_CODE_USE_BEDROCK`, `CLAUDE_CODE_USE_VERTEX`, or `CLAUDE_CODE_USE_FOUNDRY` set | Unset the selected provider flag and its credentials/configuration |
| Local Anthropic-compatible endpoint (`ANTHROPIC_BASE_URL`) | Prompts and profile context | A twin runs with `EMPLOYEE001_MODEL_PROVIDER=local`; localhost stays on this machine | Stop the local endpoint or unset its configuration |
| Direct Anthropic endpoint (`api.anthropic.com` or `ANTHROPIC_BASE_URL`) | Prompts for direct Anthropic SDK calls (rerank, dreamer, relay) | Memory distillation, relay interview, or follow-ups when an Anthropic credential is set, including alongside a cloud endpoint | Remove the Anthropic credential or do not use those features |
| `backend.composio.dev` (or `COMPOSIO_BASE_URL`) | Tool calls and OAuth data | `COMPOSIO_API_KEY` is set | Remove `COMPOSIO_API_KEY` and disconnect connected accounts |
| `api.openai.com` | Embeddings for semantic memory | `OPENAI_API_KEY` is set and `TWIN_MEMORY_ENABLED` is not `false` | Remove `OPENAI_API_KEY` or set `TWIN_MEMORY_ENABLED=false` |
| `api.elevenlabs.io` | Text submitted for text-to-speech | `ELEVENLABS_API_KEY` is set | Remove `ELEVENLABS_API_KEY` |
| Each enabled custom MCP server | MCP tool calls | The server is enabled in `data/org/custom-mcp.json` | Disable or remove that server from `data/org/custom-mcp.json` |
| Any public host | Search queries and fetched pages | A twin uses `WebSearch` or `WebFetch` while a model endpoint is configured | Do not use web research; remove model credentials to prevent twin runs |
| `api.github.com` | Release metadata | Only when you run `employee001 update` | Do not run `employee001 update` |
| `registry.npmjs.org` (or `npm_config_registry`) | Package tarball | Only when you run `employee001 update` | Do not run `employee001 update` |

### Run Claude in your own cloud

Set up AWS Bedrock, Google Vertex AI, Azure AI Foundry, or a local Anthropic-compatible endpoint with `employee001 setup`. The local preset requires an http(s) `ANTHROPIC_BASE_URL` and explicit model pins; `ANTHROPIC_AUTH_TOKEN` is optional. Ollama >= 0.14 is one compatible example. Employee001 uses `CLAUDE_CODE_USE_BEDROCK`, `CLAUDE_CODE_USE_VERTEX`, or `CLAUDE_CODE_USE_FOUNDRY` for cloud providers; it does not use `CLAUDE_CODE_USE_ANTHROPIC_AWS`, which is Anthropic-operated.

In this boundary mode, the direct Anthropic endpoint is disabled by default. That disables memory rerank, follow-up suggestions, knowledge proposals, and live Relay because those features use the direct Anthropic SDK. `EMPLOYEE001_ALLOW_DIRECT_ANTHROPIC=1` is an explicit egress opt-in; `employee001 doctor --egress` reports its effective state. This changes where Agent SDK model prompts go, not the egress behavior of enabled Composio, OpenAI embeddings, ElevenLabs, web research, or custom MCP services.

## Your compliance scope

You host Employee001, so it runs inside your environment and within your compliance scope. We make no SOC 2 or ISO claims. Assess the deployment, connected services, access controls, and data handling against the requirements that apply to your organization, as you would with other self-hosted software.

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Email **office@bulldog-adv.com** with:
- A description of the vulnerability
- Steps to reproduce or a proof-of-concept
- The potential impact as you see it

We will acknowledge receipt within **2 business days** and aim to ship a fix or mitigation within **14 days** for critical issues. We'll keep you updated as we work through it.

## Scope

Employee001 runs entirely on your local machine and binds to `127.0.0.1` by default. The primary attack surfaces are:

- **The shared-secret token** — used to gate LAN-exposed installs (`EMPLOYEE001_TOKEN` in `.env`). Weak or leaked tokens let anyone on the same network impersonate the CEO.
- **The Anthropic and Composio API keys** stored in `.env` — exposure gives an attacker access to your LLM quota and connected tools.
- **The `data/` directory** — contains employee profiles, audit logs, and org knowledge in plaintext. Protect it with filesystem permissions (`chmod 700 data/`).
- **Prompt injection** via employee profiles or org-brain documents — a malicious document could attempt to steer twin behavior.

## Out of Scope

- Issues that require physical access to the machine running Employee001
- Social engineering
- Vulnerabilities in Anthropic's or Composio's infrastructure (report those to them directly)

## Disclosure Policy

Once a fix is released, we will publish a brief advisory in `CHANGELOG.md` describing the vulnerability, its impact, and the fix — without disclosing details that would help attackers exploit unpatched installs before they upgrade.

We follow [responsible disclosure](https://cheatsheetseries.owasp.org/cheatsheets/Vulnerability_Disclosure_Cheat_Sheet.html) and will credit reporters who want to be named.
