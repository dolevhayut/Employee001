# Security Policy

## Supported Versions

| Version | Supported |
|---|---|
| The latest minor release | ✅ |
| The minor release before it | ✅ Security fixes only |
| Older releases | ❌ |

We support the latest minor release and the one before it as weekly releases continue.

## What leaves your machine

Employee001 keeps profiles, memory, audit logs, accounts and org knowledge in `./data/` on the machine where you run it. Everything below is configuration- or action-dependent. Run `npx employee001 doctor --egress` from your install to see the exact hosts active in your current configuration. Use `npx employee001 start --strict` to set the Claude Agent SDK's nonessential-traffic flag when starting the server.

### Subprocessors

These are the third parties data can reach. Regions are each provider's own statements as of 2026-10; check their current terms, and your own agreement with them, before relying on them.

| Subprocessor | What data goes there | Region | When | How to turn it off |
|---|---|---|---|---|
| **Anthropic** (`api.anthropic.com`, or `ANTHROPIC_BASE_URL`) | Prompts: the question, the twin's profile files, recalled memory, org-brain excerpts, tool results, meeting transcripts | United States | `EMPLOYEE001_MODEL_PROVIDER=anthropic` (the default) or `EMPLOYEE001_ALLOW_DIRECT_ANTHROPIC=1`: twin runs, training, meeting summaries, combined answers, memory distillation, Relay | Use your own cloud endpoint below; refused entirely in EU mode |
| **Your Claude cloud endpoint**: Amazon Bedrock, Google Vertex AI or Azure AI Foundry | The same prompts | The region you configure (`AWS_REGION`, `CLOUD_ML_REGION`, the Foundry resource) | `EMPLOYEE001_MODEL_PROVIDER=bedrock`, `vertex` or `foundry` | Unset the provider and its credentials |
| **Local model** (`ANTHROPIC_BASE_URL` on your network) | The same prompts | Your infrastructure | `EMPLOYEE001_MODEL_PROVIDER=local` | Stop the endpoint |
| **Composio** (`backend.composio.dev`, or `COMPOSIO_BASE_URL`) | OAuth tokens for connected tools; every tool call's inputs and outputs (emails read or sent, Slack messages, tickets…); the connected user id | United States; no EU region option | `COMPOSIO_API_KEY` is set and a tool is connected | Remove `COMPOSIO_API_KEY` and disconnect accounts. See [Composio](#composio) for zero data retention |
| **OpenAI** (`api.openai.com`) | Text of memory cards (question and answer, after redaction) for embeddings | United States | `OPENAI_API_KEY` is set, `TWIN_MEMORY_ENABLED` isn't `false`, and `EMBEDDINGS_BASE_URL` isn't set | Unset `OPENAI_API_KEY`, or point `EMBEDDINGS_BASE_URL` at an EU or local endpoint. Off in EU mode |
| **ElevenLabs** (`api.elevenlabs.io`, or `ELEVENLABS_BASE_URL`) | Text-to-speech: the twin's answers. Speech-to-text: **your microphone audio** | United States by default; EU via `api.eu.residency.elevenlabs.io` (ElevenLabs Enterprise, separate EU account and key) | `ELEVENLABS_API_KEY` is set and you use voice in Ask | `EMPLOYEE001_VOICE=off`. Off in EU mode unless `ELEVENLABS_BASE_URL` points at the EU endpoint. Live voice in Ask (`EMPLOYEE001_VOICE_LIVE=off` to turn it off) sends the mic and the answer text from the browser straight to ElevenLabs over WebSockets, with single-use tokens the server mints (the key stays on the server); it is off in EU mode |
| **Your browser vendor** (speech recognition) | Microphone audio | The vendor's | Voice input with no ElevenLabs key: the browser's built-in recognition (Chrome sends audio to Google) | `EMPLOYEE001_VOICE=off`, EU mode, or don't use the mic |
| **Your OIDC identity provider** | Sign-in redirects; ID tokens come back | The provider's | `EMPLOYEE001_OIDC_*` is set and someone uses single sign-on | Unset `EMPLOYEE001_OIDC_ISSUER` |
| **Slack** (`slack.com`) | Twin replies posted with the org's bot | The workspace's | `SLACK_BOT_TOKEN` is set (otherwise replies go through Composio) | Unset `SLACK_BOT_TOKEN` |
| **Each enabled custom MCP server** | MCP tool calls, including the query content of reads | The server's | The server is enabled in Settings | Disable or remove it |
| **Any public web host** | Search queries and fetched URLs | Anywhere | A twin uses `WebSearch` or `WebFetch` and someone approves it (or the admin allowlisted web search) | Don't approve web calls; keep web search off in the read allowlist |
| **Your hosting provider** (Fly.io, a VPS…) | Everything in `data/`, if you deploy there | The region you choose | You deploy Employee001 outside your own machine | Run it on your own hardware |
| `api.github.com`, `registry.npmjs.org` | Release metadata, package tarball | n/a | Only when you run `employee001 update` | Don't run it |

Telemetry is off by default and sends nothing unless you turn it on in Settings.

### EU data residency

Set `EMPLOYEE001_REGION=eu` to keep processing in the EU, or to turn a feature off where it can't be:

- **Claude** runs only on Bedrock in an `eu-*` region, Vertex in a `europe-*` region, Foundry, or a local model. The direct Anthropic API is refused, including the direct calls for meeting summaries and combined answers, which then degrade gracefully.
- **Embeddings** go only to `EMBEDDINGS_BASE_URL`, an OpenAI-compatible endpoint you run or host in the EU (for example Ollama, Hugging Face TEI, or Azure OpenAI in an EU region; `EMBEDDINGS_API_KEY` if it needs one). Without it, memory recall is keyword-only and nothing reaches `api.openai.com`.
- **Voice** (including microphone audio) is off unless `ELEVENLABS_BASE_URL=https://api.eu.residency.elevenlabs.io` with an EU-account key. The browser speech-recognition fallback is off too.
- **Composio** has no EU region; startup logs a warning while it is configured. Use it only for tools whose data may leave the EU, or don't connect tools.

`EMPLOYEE001_VOICE=off` turns voice off in any region.

### Composio

Composio stores tool-call payloads and logs unless **zero data retention (ZDR)** is on for your project. To enable it:

1. In the Composio dashboard, as an organization admin, open **Organization Settings → Billing → Add-ons** and turn on Zero Data Retention. It's available on paid plans and included on Enterprise.
2. ZDR is per project. Make sure it's on for the project whose API key is `COMPOSIO_API_KEY`.
3. Set `COMPOSIO_ZERO_DATA_RETENTION=1` in `.env` to confirm; until then Employee001 logs a startup warning.

With ZDR, Composio keeps metadata (ids, tool, timing, status) but not inputs or outputs. It still stores the user id Employee001 passes, `employee:<employee id>`; the employee id is a slug of their name, so Composio can link calls to a person by name. See [Composio's ZDR documentation](https://docs.composio.dev/docs/security/zero-data-retention) for what it doesn't cover.

Composio-managed apps are covered by ZDR only on Composio Enterprise.

## Sign-in and roles

- **Local install, no accounts**: on the default `127.0.0.1` bind the OS is the boundary and the person at the machine is the owner.
- **Accounts**: create the owner at `/auth/setup`. From then on everyone signs in, on loopback too. On an exposed bind (`EMPLOYEE001_BIND`), `EMPLOYEE001_TOKEN` only unlocks that setup page (traded for a signed 30-minute cookie, never stored raw) and stays valid as the MCP client bearer.
- **Sessions**: a random id plus an HMAC in an http-only cookie; only a hash of the id is stored. Twelve hours at most from sign-in, two hours idle, the id rotates every 30 minutes and on sign-in, MFA, role and password changes.
- **Two-factor sign-in**: TOTP (any authenticator app), turned on from your account page. Codes can't be reused.
- **Single sign-on**: OpenID Connect with PKCE (`EMPLOYEE001_OIDC_ISSUER`, `EMPLOYEE001_OIDC_CLIENT_ID`, `EMPLOYEE001_OIDC_CLIENT_SECRET`, `EMPLOYEE001_OIDC_REDIRECT_URI` or `APP_URL`). People are matched by verified email; `EMPLOYEE001_OIDC_ALLOWED_DOMAINS` lets unknown people from those domains in as members. **SAML isn't supported yet.**
- **Roles**: owner (everything), admin (settings, connections, allowlists, deletion, audit export), approver (approves twin actions), member (uses twins), employee (sees only their own twin and can withdraw consent). Every API route is in one table (`src/lib/auth/rbac.ts`); a test fails when a route is missing, and unknown routes are denied.
- Failed sign-ins are rate limited per account and per IP. Sign-ins, account changes and MFA changes are audited.

## What a twin can reach

### Optional OS sandbox for twin runs

The normal twin boundary is enforced in the Agent SDK process: tool hooks remove
Bash, restrict reads and writes, and pass only an allowlisted child environment.
Set `EMPLOYEE001_SANDBOX=1` to add Anthropic's Sandbox Runtime as a second,
OS-level boundary around the Claude Code child process. It denies sensitive
Employee001 files and limits writes to twin data/scratch areas; it also sends
child traffic through an allowlisted egress proxy. This contains a compromised
CLI or a bypass of an in-process hook, but does not replace the consent,
approval, audit, or tool policies described below.

Hardened mode is opt-in and fails closed: a twin run refuses to start if the
runtime or an operating-system dependency is unavailable. macOS needs a real
`rg`/ripgrep binary on `PATH`. Linux additionally needs bubblewrap and socat.
Windows is refused while upstream support remains alpha. Public web research is
still permitted through the sandbox's approval callback and every such host is
written to the audit log as `sandboxNetwork`. Loopback, link-local, cloud
metadata and private-network targets are refused, both as hostnames (by
resolved address) and as IP literals or `localhost`, except the explicit
port-qualified loopback literal required for a configured local model or
enabled local MCP server. The sandboxed child gets only the scrubbed twin
environment plus the sandbox's proxy variables, never the server's own
environment.

On Linux, bubblewrap needs unprivileged user namespaces (Ubuntu 24.04 may also
need `kernel.apparmor_restrict_unprivileged_userns=0`). A default Docker
container can't provide them, so hardened mode refuses to start there with a
clear reason. Running the container with `--privileged` works but gives up the
container's own isolation; this is not tested on Fly yet. Claude Code session state remains
writable for subscription sign-in, but sandboxed twins cannot modify Claude
Code settings, plugins, hooks, skills, agents, commands, output styles, or
`~/.claude.json`.

- **Consent first**: a twin whose employee hasn't recorded consent can't be trained, gets none of the employee's tools or meeting transcripts, and can't act through their accounts. The synthetic demo twins are exempt. Consent is recorded with evidence (who, when, which consent text by SHA-256, scopes, IP, user agent) in the audit chain.
- **Reads**: a twin's `Read`, `Glob` and `Grep` are limited to its own folder, colleagues' nine profile files, `org-brain/` and `org-skills/`, in every run type (chat, meeting, routines, work items, shifts, training). A local folder an admin adds as a twin's knowledge source is readable by that twin only, never `.env*`, key files, `.git` or `node_modules`, and `Grep` there works one file at a time. What a twin reads in such a folder is untrusted input it treats as data: a malicious file there can attempt prompt injection, which the read rules, approvals and the sandbox contain but don't prevent. Other twins' memory and chat history, invites, the audit log and settings are blocked.
- **External reads**: a read through a connected tool or MCP server sends query content out, so it runs on its own only when an admin listed that source in the read allowlist (seeded with what was already connected); otherwise it asks. `WebSearch` asks unless the admin turns it on. A per-employee "allow" can't open `WebFetch` or `WebSearch` without the admin's switch.
- **Approvals**: write actions (send, post, create, update) and every `WebFetch` wait for an approver. The audit row records who approved, where (UI, Telegram, Slack), who asked, and the organization.
- **AI disclosure**: every Slack message and email a twin sends starts with "🤖 AI twin of &lt;name&gt;:" (EU AI Act Art. 50). It is added at the last step, after any human edit, so it can't be dropped.
- **Slack auto-replies** need the admin's allowlist: only allowlisted org members, in a DM or an allowlisted channel, from your own workspace, and never for a request to act. Auto-replies are drafted with no tools, no memory and only the non-confidential profile files, and are audited with the requester's Slack id. Everything else waits for approval. With `SLACK_BOT_TOKEN` they post as the org's bot rather than as the employee.
- **What twins keep**: profile files and memory are filtered in code for special-category data (health, union, religion, sexuality, politics, criminal records), performance or loyalty judgments, and work-hour patterns. Memory also redacts emails, phone numbers, national ids, IBANs and card numbers (`EMPLOYEE001_MEMORY_REDACT=off|basic|strict`, default `basic`; secrets are always redacted).
- **The model process** gets only the environment variables it needs, not the app's other secrets.
- **Email and Slack** content handled by a twin is passed in as untrusted data, never as instructions.

## When someone leaves (Relay)

A departing employee's twin is kept only if they agree, during the handover, to
keep it after they leave. That answer is recorded with the date and a SHA-256
of the consent wording in the audit log, marked "on behalf" when an admin
records it rather than the employee signed in as themself. Without it the twin
can't be retired; it is deleted. Approving the notes is tied to the exact
version the admin reviewed, and nothing the interview writes lands after the
handover is closed.

A retired twin answers colleagues from its EXPERTISE, DECISIONS, CONTEXT,
PROJECTS, TONE and BOUNDARIES files and the handover notes an admin approved.
PEOPLE, PREFERENCES and EMPLOYMENT move out of the profile folder when it
retires, so neither it, colleagues' twins, the org brain nor the profile pages
can read them. Its memory, the org
brain and every tool: it runs with no built-in tools and no MCP servers, takes
no work items, routines, shifts or tasks, can't approve another twin's request,
and writes no new memory. It is labelled as a former employee wherever it
answers.

The handover interview and notes live in `data/handovers/<id>/`. Downloads of
the notes are audited. Deleting the twin deletes them with everything else.

## Deleting an employee's data

Deleting a twin, or revoking its consent on the profile page (the employee can do this themselves with the employee role), removes the data right away:

- profile and versions, knowledge files, memory, chat history, scratch notes
- handover and relay data, shifts, run logs, routines, work items
- invites, feed items, pending approvals, and their turns and shared files in live meetings

The twin's Composio connected accounts are deleted, so their tokens stop working. If Composio can't be reached, the deletion reports itself incomplete and can be retried. Goals the employee owned stay with the company, unassigned.

Mentions of the employee (their id or full name) in other twins' memory and profile files and in the org brain are replaced with "[former employee]". The deletion record lists which files changed.

The audit log keeps each row's time, tool and outcome. The tool input and name are erased, and the employee id becomes a keyed pseudonym, stable per install but not reversible without the install's key. A deletion record is appended and the hash chain still verifies.

**What remains elsewhere:**

- **Composio** keeps its own logs of past tool calls (unless ZDR was on) and the user id. Ask Composio support to delete the data for your project's user `employee:<employee id>` (the id in the twin's profile URL before deletion).
- **Anthropic, OpenAI and ElevenLabs** keep API inputs only as their API terms allow; request deletion from them if your agreement needs it.
- **Backups and exports** you made earlier (`employee001 export`, audit exports) are yours to delete.
- **A first name on its own** in free text is not searched, since it is too ambiguous to replace safely.

## Audit log

Every tool call, approval, sign-in, consent and deletion is appended to a hash-chained log in `data/`. Admins can download it from `GET /api/audit/export`. Anyone can check a log offline with `npx employee001 audit verify [file]`.

## Your compliance scope

You host Employee001, so it runs inside your environment and within your compliance scope. We make no SOC 2 or ISO claims. Assess the deployment, connected services, access controls, and data handling against the requirements that apply to your organization, as you would with other self-hosted software.

## Verifying a release

Download the release tarball, then verify its build provenance with the GitHub CLI:

`gh attestation verify employee001-<version>.tgz -R dolevhayut/Employee001`

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Email **office@bulldog-adv.com** with:
- A description of the vulnerability
- Steps to reproduce or a proof-of-concept
- The potential impact as you see it

We will acknowledge receipt within **2 business days** and aim to ship a fix or mitigation within **14 days** for critical issues. We'll keep you updated as we work through it.

## Scope

Employee001 runs on your own machine or server and binds to `127.0.0.1` by default. The primary attack surfaces are:

- **Accounts and sessions**: weak passwords or a leaked `EMPLOYEE001_TOKEN` before the first owner exists. Turn on two-factor sign-in for owners and admins.
- **API keys** in `.env` (Anthropic, Composio, OpenAI, ElevenLabs, Slack bot). Exposure gives an attacker your model quota and connected tools. `npx employee001 secure` moves them into the OS keychain.
- **The `data/` directory**: profiles, memory, audit logs, accounts and org knowledge in plaintext. Protect it with filesystem permissions (`chmod 700 data/`) and disk encryption.
- **Prompt injection** via employee profiles, org-brain documents, email or Slack: a malicious document could attempt to steer twin behavior. Approvals, read scopes and the read allowlist limit what it can reach.
- **Webhooks** (`/api/email/composio`, `/api/slack/composio`): signed by Composio, with a five-minute timestamp window and one-time delivery ids.

## Out of Scope

- Issues that require physical access to the machine running Employee001
- Social engineering
- Vulnerabilities in Anthropic's, Composio's or other subprocessors' infrastructure (report those to them directly)

## Disclosure Policy

Once a fix is released, we will publish a brief advisory in `CHANGELOG.md` describing the vulnerability, its impact, and the fix, without details that would help attackers exploit unpatched installs before they upgrade.

We follow [responsible disclosure](https://cheatsheetseries.owasp.org/cheatsheets/Vulnerability_Disclosure_Cheat_Sheet.html) and will credit reporters who want to be named.
