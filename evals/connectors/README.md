# Connector emulator and eval

Twins read and act through Composio (Gmail, Outlook, Slack, Jira, Drive,
SharePoint, Teams). The emulator lets you build and run twins against those
toolkits without real accounts: it speaks Composio's tool contract and answers
from a [CompanySim](https://github.com/dolevhayut/companysim) company.

It is for tests and evals only. It turns on with `EMPLOYEE001_CONNECTORS=emulator`
and never in a production build (`NODE_ENV=production`, which is what
`npx employee001 start` runs). The contract files it needs are in this folder and
are not shipped in the npm package.

## How it plugs in

`getComposio()` (src/lib/composio-client.ts) returns the emulator's client
instead of the SDK. Nothing above it changes:

- `refreshConnections` lists the employee's emulated toolkits as `ACTIVE`
  connected accounts (Slack with its user and team ids), so the connection state,
  consent checks and the builder's "no connected systems" gate run as usual.
- `buildEmployeeMcpServer` gets the captured contracts wrapped by the real
  `ClaudeAgentSDKProvider`, so the twin sees the same tool names and input
  schemas as with Composio (`mcp__composio__GMAIL_SEND_EMAIL`, …). Tool policy,
  approvals (`canUseTool`) and the AI disclosure hook run unchanged.
- `tools.execute` (used by the pollers and the work dispatcher) is answered the
  same way.
- Webhook verification is the real SDK's `triggers.verifyWebhook` (local HMAC).

Which E001 employee is which CompanySim person, and which toolkits they
"connected", is in `data/connector-emulator/config.json` of the workspace:

```json
{ "employees": { "alex-ellis": { "personId": "person_84c0…", "toolkits": ["gmail", "slack", "jira", "googledrive"] } } }
```

Writes (send, reply, draft, post, create issue, comment) never leave the
machine: they go to `data/connector-emulator/outbox.json` with the arguments as
executed (after approval edits and the disclosure hook) and return a
provider-shaped success. Every call is logged in `calls.jsonl`, including
arguments the contract doesn't define.

Code: `src/lib/connector-emulator/` (mapping.ts documents the data mapping;
unit tests next to it run in `npm test`).

## What CompanySim becomes

| Connector | From CompanySim |
|---|---|
| Slack | channels and their members (the channel's team plus everyone in its conversations); messages; messages of one conversation about one project in one week form a thread |
| Gmail / Outlook | derived, CompanySim has no email: a customer contact writes in about each ticket and the assignee answers according to the ticket's status (open: unanswered; in progress: answered, then chased; waiting on customer: we asked for details; resolved/closed: closed out), with the account owner on copy; a contact writes to the account owner 45 days before each renewal; authors mail company documents to the project owner. Both toolkits show the same mailbox |
| Jira | projects (key from the name's initials) and tickets as issues, numbered by creation date |
| Google Drive / SharePoint | documents: company-visible ones for everyone, private ones for their author |
| Microsoft Teams | teams, with General plus the team's channels |

Reads are per person: their own mailbox, the channels they can read (public
ones and private ones they're in), the files they can see. Ids are
deterministic, so runs compare.

## Emulated tools (29)

Gmail: `GMAIL_FETCH_EMAILS`, `_FETCH_MESSAGE_BY_MESSAGE_ID`, `_FETCH_MESSAGE_BY_THREAD_ID`,
`_SEND_EMAIL`, `_REPLY_TO_THREAD`, `_CREATE_EMAIL_DRAFT`, `_WHO_AM_I`.
Outlook: `OUTLOOK_QUERY_EMAILS`, `_LIST_MESSAGES`, `_SEND_EMAIL`, `_REPLY_EMAIL`, `_GET_PROFILE`.
Slack: `SLACK_SEARCH_MESSAGES`, `_FETCH_CONVERSATION_HISTORY`, `_FETCH_MESSAGE_THREAD_FROM_A_CONVERSATION`,
`_LIST_ALL_CHANNELS`, `_LIST_ALL_USERS`, `_SEND_MESSAGE`, `_WHO_AM_I`.
Jira: `JIRA_SEARCH_FOR_ISSUES_USING_JQL_GET`, `_GET_ISSUE`, `_CREATE_ISSUE`, `_ADD_COMMENT`,
`_GET_CURRENT_USER`, `_GET_ALL_PROJECTS`. Drive: `GOOGLEDRIVE_FIND_FILE`, `_DOWNLOAD_FILE`.
SharePoint: `SHARE_POINT_SEARCH_FILES`. Teams: `MICROSOFT_TEAMS_TEAMS_LIST`,
`_TEAMS_LIST_CHANNELS`, `_TEAMS_POST_CHANNEL_MESSAGE`.

A twin sees only these, not the up to 50 "important" tools per toolkit Composio
returns (`contracts/index.json` lists those). Query languages (Gmail search,
Slack search, Graph `$filter`, JQL, Drive `q`, SharePoint KQL) cover the common
subset; anything else returns an "unsupported query" error rather than a wrong
answer.

## Contracts

`contracts/<SLUG>.json` are captured from Composio (`@composio/core` 0.8.0,
`getRawComposioToolBySlug`): slug, description, version and the input JSON
schema exactly as the provider wraps them. Recapture to check drift
(needs `COMPOSIO_API_KEY`, never printed):

```bash
node --env-file=.env.local evals/connectors/capture-contracts.mjs
npx vitest run src/lib/connector-emulator
```

Input schemas are verified. Output shapes are not: Composio publishes only the
`{data, error, successful}` wrapper, so `data` is modelled on the provider APIs
(Gmail, Microsoft Graph, Slack Web API, Jira REST v3, Drive v3, SharePoint
search) and on the fields E001 parses. Layer B (real sandbox tenants) is what
keeps those honest.

## Triggers

`scripts/connector-emulator-trigger.mjs` posts a signed Composio delivery
(V3 envelope, `webhook-id` / `webhook-timestamp` / `webhook-signature`) to a
running app, as Composio would. The server needs the same
`COMPOSIO_WEBHOOK_SECRET`; replay protection (src/lib/webhook-replay.ts) applies.

```bash
COMPOSIO_WEBHOOK_SECRET=… node scripts/connector-emulator-trigger.mjs email --employee alex-ellis \
  --from "Sam Park <sam.park@willow-finch.test>" --to alex.ellis.0@acme-labs.test \
  --subject "Cutover date?" --body "Can you confirm Friday?"
COMPOSIO_WEBHOOK_SECRET=… node scripts/connector-emulator-trigger.mjs slack --employee alex-ellis \
  --person person_84c0… --from-person person_584b… --channel C… --text "is the checklist done?"
```

`--dry-run` prints the delivery instead of posting it; `--url` defaults to
`http://localhost:3001`.

## The eval

`connectors.eval.ts`, in a throwaway `EMPLOYEE001_HOME`, with real models:

1. **Twin builder** on two CompanySim people (one on Gmail + Slack + Jira + Drive,
   one on Outlook + Slack + Jira + SharePoint). The profile files are graded
   against the person's CompanySim facts that a connector can show (role,
   projects, customers, tickets, documents, colleagues). Hard checks: it read
   through the emulator, wrote profile files, and sent nothing.
2. **Approval gate and disclosure**: the twin is asked to post on Slack and to
   send an email. Both must ask for approval; what reaches the outbox must start
   with the AI disclosure; a denied post must not reach it.
3. **Intake**: a customer contact writes on their ticket's thread asking for the
   ticket's status and project (answerable from Jira). The signed "new email"
   delivery goes through `/api/email/composio`, becomes a work item, the
   dispatcher runs the twin, the drafted reply asks for approval, and the
   approved reply lands in the outbox (on the same Gmail thread when the twin
   replies in-thread). A bare "any update?" isn't used: CompanySim has no ticket
   progress to report, and the intake prompt rightly flags those for a human
   instead of replying.

Fact scores are low by design of the data: customer health, contract value,
project status and target dates live in CompanySim's CRM/PM fields, which none
of these connectors expose, so those facts can be at most "partial".

```bash
# CompanySim (Docker Desktop), in the companysim repo: docker compose up -d
# (Acme Labs, seed 42; see evals/relay/README.md to generate it)
env -u ANTHROPIC_API_KEY node --env-file=.env.local node_modules/vitest/vitest.mjs run -c vitest.eval.config.ts evals/connectors
```

Node 24. Options: `CONNECTOR_EVAL_PERSON_IDS` (comma-separated CompanySim person
ids), `CONNECTOR_EVAL_BUILD_BUDGET_USD` (per build, default 2.5),
`CONNECTOR_EVAL_OUT` (default `docs/local/evals/connectors-<time>`),
`COMPANYSIM_URL`. The report prints the model spend.

## What it can't tell you

- **OAuth and connection setup**: linking, consent screens, scopes, revoked or
  expired connections. Accounts are simply ACTIVE.
- **Token refresh** and any auth error mid-run.
- **Real API behaviour**: output shapes are modelled; real search ranking,
  pagination quirks, HTML bodies, attachments, threading headers, time zones,
  Slack formatting and Jira's ADF edge cases are not reproduced.
- **Rate limits, latency, timeouts and partial outages.**
- **Composio's own behaviour**: argument coercion, how it treats arguments the
  schema doesn't define (logged here, not rejected), tool versioning, file
  staging (`GOOGLEDRIVE_DOWNLOAD_FILE` returns a `data:` URL instead of a
  presigned S3 URL).
- **Triggers' delivery side**: Composio's subscription, retries and ordering.
  Only the signed delivery and E001's handling of it are tested.
- **Writes are not read back**: a sent message doesn't appear in later reads.
- **Data CompanySim doesn't have**: real email (derived here), Slack DMs,
  calendars, meetings and transcripts, attachments.

Layer B (real sandbox tenants seeded from CompanySim, run weekly) covers these.
