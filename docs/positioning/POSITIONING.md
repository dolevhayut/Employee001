# Employee001 positioning

Last reviewed: 2026-10-21. Every claim below was checked against the code on `main` (paths given) or against the competitor's own public pages (URLs given). If the code changes, re-check the claim before reusing the copy.

## Old vs new

| | Before | Now |
|---|---|---|
| Headline | "Your organizational brain." | "Your real team. Now with AI twins." |
| Category | Organizational brain / AI workforce | AI twins grounded in your real employees' work |
| Lead idea | Abstract (a "brain") plus a feature list | A concrete person: ask the twin of the colleague who knows |
| Proof | Feature checklist vs competitors | Three proof pillars, each tied to code |
| Privacy line | "Your data stays on your machine", "No telemetry" | Four separate boundaries: stored locally, sent to the model provider, sent to connected tools, telemetry (opt-in, off by default) |

"Organizational brain" stays as a supporting phrase (the Org Brain feature, the Ask the company surface), not as the headline. It describes the outcome, not what makes the product different.

## Primary ICP

**Growing companies, roughly 15 to 200 people, where a few people hold the answers.** Founder-led or ops-led teams that run on Slack, Gmail, Linear/Jira, GitHub and a CRM, with at least one technical person who can run `npx` or a small server.

- **Economic buyer:** founder, CEO or COO who feels the bottleneck personally (everyone asks them, or the same three senior people).
- **Technical evaluator:** CTO or a senior engineer who reads the README, SECURITY.md and the code before anything gets connected.
- **Why them first:** the pain is acute (expertise is concentrated), the setup cost is acceptable (self-host, own keys), and they don't yet have an internal knowledge team or an enterprise search contract.

**Not the ICP yet:** regulated enterprises needing SSO/SCIM, certifications or a managed SaaS (Cloud is a waitlist; SSO/RBAC/MFA are not shipped), and non-technical teams who can't self-host.

## Problem statement

In growing companies, the knowledge that runs the business lives in a few people's heads and in scattered threads across Slack, email, tickets and code. Everyone else waits for those people, so they become a bottleneck; cross-functional questions wait for a meeting slot; and context is at risk whenever someone is on leave or changes roles. Search tools find documents, and generic AI agents know what a role usually does, but neither knows what *your* colleague decided, why, and who to involve.

## Category definition (one sentence)

**Employee001 is open-source, self-hosted software that builds an AI twin of each employee from the work they connect, so the rest of the company can ask the person who knows, convene several in a Team Meeting, and approve any external action before it runs.**

## Primary USP

**Twins grounded in real, named employees, not role templates.** A twin starts from one person's own work history (the tools they connect after a consent screen) and is written into nine readable, editable profile files. The answer reflects how *your* company works, and you can see exactly what the twin is answering from.

## Three proof pillars

### 1. Grounded in a real person's work, and inspectable

- An admin invites a named employee with a 30 to 360 day lookback (`src/lib/invites.ts`, `src/app/api/invites/route.ts`).
- The employee sees a consent screen, answers role questions and connects their tools via Composio OAuth (`src/app/onboarding/page.tsx`, `src/app/api/invites/[token]/connections/initiate`, `src/app/api/invites/[token]/complete/route.ts`).
- A training agent reads that history through a read-only gate (120 turns, $5 cap) and writes nine Markdown files: CONTEXT, EXPERTISE, PROJECTS, PEOPLE, DECISIONS, PREFERENCES, TONE, BOUNDARIES, EMPLOYMENT (`src/lib/twin-builder.ts`, `src/lib/twin-builder-types.ts`).
- The files are editable in `/profile`; PDF and Word uploads become knowledge (`src/lib/knowledge-files.ts`). Twins are not fine-tuned: the profile, org brain and memory are injected into prompts for Claude via the Agent SDK (`src/lib/council-runner.ts`, `src/lib/sdk-defaults.ts`).

### 2. Ask one, ask the company, or convene several

- **Ask a twin** (`/flow`): one twin, with its run shown as a workflow.
- **Ask the company** (`/ask`): routes the question to 1 to 3 relevant twins, the Org Brain and org MCP systems in parallel, read-only, then writes one answer citing each claim (`src/lib/org-ask.ts`, `src/lib/org-router.ts`, `src/lib/org-answer.ts`).
- **Team Meeting** (`/council`): selected or @mentioned twins take turns on a question, can tag colleagues in, and a "Summarize & decide" step returns a decision, owned actions and open questions (`src/lib/council-runner.ts`, `src/lib/meeting-summary.ts`).
- **From the editor:** an MCP server exposes `list_twins`, `get_twin_profile`, `search_org_brain`, `ask_twin` and more to Claude Code or Cursor (`src/lib/mcp-server/`, `docs/mcp.md`).

### 3. People stay in control of what leaves

- Write actions and every `WebFetch` wait in an approval queue by default; read-only calls run on their own; deletes and payments are always blocked (`src/lib/tool-policy.ts`, `src/lib/approval-bus.ts`).
- Every executed tool call goes to a SHA-256 hash-chained audit log with a verify endpoint (`src/lib/audit-log.ts`, `/api/audit/verify`).
- Twins cannot run shell commands (`Bash` is hard-disallowed twice, `src/lib/sdk-defaults.ts`).
- Deleting an employee or revoking consent purges their twin's data and Composio connections (`src/lib/employee-purge.ts`).
- Data is files under `data/` on your machine; no database, no Employee001 account.

## Buyer objections, with evidence-based answers

**1. "Is this surveillance of my employees?"**
The employee is part of the process: they open the invite, see a consent screen with required and opt-in scopes, and connect their own tools. Acting through their accounts or transcripts are separate opt-in scopes (`src/lib/employees.ts`, `src/lib/consent-policy.ts`). The twin's profile is nine plain files anyone authorized can read, and deletion purges everything tied to that person. Be honest about the limits: an admin can also start a tool connection for an employee from `/connections`, and only the admin can revoke today.

**2. "Where does our data go?"**
Stored locally: profiles, knowledge, memory, chats, approvals, audit log (`data/`). Sent to your model provider: prompts with the profile context a twin needs, to the Anthropic API or your own Bedrock / Vertex AI / Azure AI Foundry / local endpoint (`src/lib/model-provider.ts`). Note: building a twin, meeting summaries and the combined answer in Ask the company currently call the Anthropic API directly. Sent to connected tools: tool calls via Composio and any custom MCP server. Optional: OpenAI embeddings for memory, ElevenLabs for voice (text and microphone audio). Telemetry: opt-in only, aggregate counts, no endpoint configured by default (`src/lib/telemetry.ts`). `npx employee001 doctor --egress` prints the hosts for your configuration. Don't promise provider non-retention or non-training; point to the provider's own terms.

**3. "Will a twin do something on its own?"**
Not by default. External writes and web fetches wait for approval (10 minutes in chat, 6 hours for background work, then denied). Scheduled routines only run when Autonomy is on, which defaults to off (`src/lib/workspace-mode.ts`). An admin can loosen this per employee and per tool, and can opt a twin into direct Slack replies; those are explicit choices, and every call is audited.

## Headline test

| Candidate | Verdict |
|---|---|
| "Your organizational brain." (current) | Memorable, but abstract and shared by many tools. Doesn't say what's different. |
| **"Your real team. Now with AI twins."** | **Keep.** "Real" carries the USP in two words; short, concrete, not hype. Weakness: no benefit. Fix it in the subheadline. |
| "Ask the colleague who knows. Even when they're busy." | Strong benefit, but implies you're talking to the person, and hides that it's AI. Use as a section line, not the H1. |
| "AI twins of your real team." | Clear and literal; good for the GitHub description and meta title. |
| "The future of work" / "Get ready for 2030" | Avoid: hype, unprovable. |

**Hero:** "Your real team. Now with AI twins."
**Subheadline:** "Employee001 builds an AI twin of each employee from their own work: the expertise, decisions and tools they choose to connect. Ask the twin of the person who knows, convene the right twins in a Team Meeting, and approve external actions before they run."

## 30-second elevator pitch

In most growing companies, the answers live in a few people's heads, and everyone waits for them. Employee001 builds an AI twin of each employee from their own work: they connect their tools, and a training agent writes what they know, what they decided and how they work into files you can read. Anyone can ask a twin, ask the whole company and get a cited answer, or put the right twins in a Team Meeting that ends in a decision. Twins draft the email or the ticket, and a person approves it before it goes out. It's open source and runs on your own machine.

## Competitive frame (reviewed 2026-10-21)

Win on the starting point, not a feature checklist.

- **Paperclip** ([repo](https://github.com/paperclipai/paperclip), [docs](https://docs.paperclip.ing), [v2026.1001.0](https://github.com/paperclipai/paperclip/releases/tag/v2026.1001.0)): MIT, self-hosted, manages a company of AI agents (org chart, goals, tickets, budgets, board governance) on bring-your-own runtimes. Agents are configurable AI employees with titles and instructions. Overlap: self-hosting, routines, MCP and Composio, audit trail, approvals, cloud waitlist. Its v2026.1001.0 notes say execution harnesses default to full auto unless a restrictive mode is set.
- **Cabinet** ([repo](https://github.com/cabinetai/cabinet), [site](https://runcabinet.com), [docs](https://docs.runcabinet.com/cabinet/agents/)): MIT, local, an AI workspace with a git-versioned Markdown knowledge base and agent personas from about 20 templates. Overlap: files on disk, approval queue before external actions, MCP, scheduled jobs, cloud waitlist.

Neither product's public pages (as read on 2026-10-21) describe building an agent from a named employee's own work history. Say "we start from your real people", not "they can't".

## Claims to avoid (unsupported or partial today)

- "Nothing leaves your machine" / "No cloud" / "No telemetry". Use the four boundaries instead.
- "The employee authorizes their own twin, not the CEO." Both paths exist.
- "Bedrock/Vertex/local instead of an Anthropic key" without the caveat. Twin chat, meetings and twin building run on the chosen provider; Ask's combined answer, meeting summaries, memory rerank and knowledge proposals still need the Anthropic API.
- "Twins debate / argue it out." They take short turns and can tag each other; the verdict is a separate summary step.
- "What one twin learns, the others can use." Profiles and curated org-brain nodes are shared; memory and meeting learnings stay with each twin.
- "Fine-tuned", "trained model", "replaces employees", any certification, customer or usage number.
- Consent deny-by-default, AI disclosure on outbound Slack/email, the Slack auto-reply allowlist, SSO/RBAC/MFA: in progress on `main`, not in a release. Don't market them until they ship.

## Suggested GitHub metadata (not applied)

- **Description:** "AI twins of your real team, built from each employee's own work. Ask one, ask the company, or convene a Team Meeting, with approval before external actions. Open source, self-hosted."
- **Topics:** `ai-twins`, `digital-twins`, `knowledge-management`, `organizational-knowledge`, `ai-agents`, `multi-agent`, `claude`, `claude-agent-sdk`, `mcp`, `composio`, `human-in-the-loop`, `self-hosted`, `local-first`, `open-source`, `nextjs`
