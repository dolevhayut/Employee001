# Compliance and security fixes, October 2026

Scope: the compliance brief of 2026-10-21 against `main` after v0.7.0.
Method: one small commit per item, a failing test before each fix, and `npm test` green before every push.

## What the code does today (checked, not assumed)

| Area | Finding |
|---|---|
| Slack auto-reply | `deliverSlackReply` (work-dispatcher.ts) posts with the employee's own Composio user token when `answerSlackWithoutAsking` is on. It uses a regex (`isActionRequest`) to decide, adds no disclosure, and writes no requester id to the audit row. |
| Consent | `has()` in consent-policy.ts returns true for every status except `recorded`. Legacy twins get tools, transcripts and third-party actions. Only training is blocked. |
| council-debug.log | HEAD no longer writes it: `dlog` is console-only (council-runner.ts ~1516). The regression was fixed in a later commit, so this item becomes a guard test plus the purge change. |
| Purge | It misses `meetings/`, deletes the whole shared `council-debug.log`, and keeps the name-derived `employeeId` slug in audit rows. It does not search other twins' memory or the org brain. |
| Identity | `proxy.ts` gates on one shared `EMPLOYEE001_TOKEN`, stored raw in a 30-day cookie. There are no users, roles or MFA. Loopback bypasses the gate entirely. |
| Audit | The hash chain (`prevHash`, `hash`, input and name digests) and the `/api/audit/verify` route exist. There is no `approvedBy`, `approvalChannel`, `requesterId` or `tenantId`, and no export. |
| Webhooks | `verifyComposioWebhook` checks the signature only. There is no timestamp window and no nonce store. |
| Tool policy | `WebSearch` and every `GET/LIST/SEARCH/FETCH/READ/FIND` external tool are auto-allowed. A per-employee `allow` override re-enables `WebFetch`. |
| Profiling | Bans in twin-builder are prompt-only, and there is no output filter. |
| Memory | `sanitize()` (twin-memory.ts) strips keys only. relay/synthesis.ts already has `redactPii` (emails, phones, tokens), which can be reused. |
| Read scope | Shift, council (including routines via `runSingleTwin`/`runShift`) and the builder set `restrictReadsToTwinScope`. Relay uses the Messages API with no file tools, so read scope doesn't apply; a test will pin that. org-ask's systems agent has no file tools (`readOnly` with MCP only). |
| SDK env | `buildBaseOptions` passes the whole `process.env` to the Claude Code child. |
| Subprocessors | SECURITY.md says 0.6.x, lists ElevenLabs as TTS only, and covers neither STT/microphone audio nor regions. |

## Plan, in commit order

### P0
1. **Debug-log guard.** Add a test that scans `src/` for file writes to `*debug*.log` or writes containing prompt or user content. Purge removes only the legacy file's lines naming the employee, and drops the file when it holds nothing else.
2. **Slack/email AI disclosure.** Add `withAiDisclosure(text, employeeName)` and apply it inside `postSlack` and the email send path, so no caller can skip it. The prefix is `🤖 AI twin of <name>:`, and it is idempotent.
3. **Auto-reply policy.** Add `slackAutoReplyDecision({ settings, requester, channel, text, externalWorkspace })` that returns `auto` or `approval` with a reason.
   - Approval is the default.
   - `auto` only when the admin allowlist contains the sender or channel, the requester is a known org member, and the text is not an action request.
   - The allowlist lives in `org/slack-autoreply.json` and is edited by admin or owner only.
4. **Auto-reply audit.** Every auto-reply writes an audit row with `requesterId`, channel and `approvalChannel: "policy"`.
5. **Consent deny-by-default.**
   - `has()` grants only for `exempt` or `recorded` with the scope.
   - A new status `consent_required` covers legacy twins, and a one-time migration marks them.
   - A banner in the UI asks for re-consent through the existing invite flow.
6. **Consent evidence.** The `/complete` route appends a `consentRecorded` audit row with employee id, timestamp, consent text version plus its SHA-256, IP, user agent, and channel (`invite`). The row is hash-chained, which makes it tamper-evident.

### P1
7. **Accounts.**
   - Users are stored in `data/auth/users.json` with a scrypt password hash.
   - Login is local plus OIDC (authorization-code + PKCE, implemented with `node:crypto`, no new dependency).
   - TOTP follows RFC 6238 and is implemented with `node:crypto`.
   - Sessions are a signed, random session id in the cookie (never a token), with a 12h max and rotation on login and privilege change.
   - `EMPLOYEE001_TOKEN` stays as a bootstrap path that creates the first owner.
8. **RBAC.**
   - Roles: owner, admin, approver, member, employee. An employee is limited to their own twin (view and revoke).
   - One route table, enforced in `proxy.ts`, with a test that fails when any `route.ts` lacks an entry.
9. **Audit fields.**
   - Add `approvedBy`, `approvalChannel` (`ui | telegram | slack | policy`), `requesterId` and `tenantId`.
   - Add `GET /api/audit/export` (JSONL with chain) and `npx employee001 audit verify`.
10. **Webhook replay protection.** Reject a timestamp outside ±5 min and a nonce (webhook id) already seen in the last 10 min, on both Composio routes.
11. **Purge completeness.**
    - Add `meetings/` (meetings the employee took part in are redacted, not deleted, since they belong to the company).
    - Pseudonymize `employeeId` in audit rows with an HMAC under a per-install salt.
    - Redact name and id mentions in other twins' memory and the org brain, and log each redaction.
    - Document Composio-side deletion.
12. **External reads.**
    - External `GET/LIST/...` and `WebSearch` go to `ask` unless an admin allowlist names them.
    - Internal scoped reads stay auto.
    - A per-employee `allow` can't re-enable `WebFetch`/`WebSearch` without an admin-set flag.
13. **Profiling filter.** Add `filterProfilingContent()` applied to DECISIONS.md, TONE.md and memory writes. It covers special-category terms (health, union, religion, ethnicity, sexuality, politics), performance and loyalty judgments, and work-hour patterns. It comes with adversarial tests.
14. **PII redaction.** Extend `sanitize()` with `redactPii` plus ID numbers and special-category keywords, configurable via `EMPLOYEE001_MEMORY_REDACT=off|basic|strict` (default `basic`).
15. **Read scope tests.** One test per run type: shift, council, routine, builder, relay (no file tools), and org-ask (no file tools).
16. **SDK env allowlist.** Pass PATH, HOME, TMPDIR, LANG, provider variables, proxy/CA variables and `CLAUDE_*`/`ANTHROPIC_*` only.

### P2
17. **SECURITY.md (0.7.x).** Add a subprocessor table with region and data per provider.
18. **Region config.**
    - `EMPLOYEE001_REGION=eu` refuses the direct Anthropic API (Bedrock eu-* or Vertex europe-* required).
    - It switches embeddings to a local or EU endpoint (`EMBEDDINGS_BASE_URL`) or turns them off.
    - `EMPLOYEE001_VOICE=off` disables TTS and STT.
19. **Composio ZDR.** Document how to enable it, and log a startup warning when `COMPOSIO_ZERO_DATA_RETENTION` isn't set.
20. **Wrap-up.** CHANGELOG entry and the status table.

## Decisions (Dolev, 2026-10-21)
- Q1: the synthetic demo fixture is exempt (`exempt: synthetic`). Every other legacy twin becomes `consent_required`, with a banner and a re-consent invite. The CEO's own twin can self-consent with evidence.
- Q2: OIDC now. SAML is deferred and recorded as remaining risk.
- Q3: a prefix on every message, plus the bot identity when `SLACK_BOT_TOKEN` is set.
- Q4: an allowlist mapped to known org members. Auto-replies get no tools and use only non-confidential profile files. Everything else needs approval.

## Open questions (design conflicts, asked before building)
- **Q1 Consent flip and existing twins.** Every twin created in-app (not through an invite), and every example twin, is legacy today, so deny-by-default turns their tools off. What to do with the synthetic demo fixture and the CEO's own twin?
- **Q2 SAML.** Safe SAML needs a vetted XML-signature library, and hand-rolling it invites signature-wrapping bugs. Should we add `@node-saml/node-saml` (≥7 days old) or ship OIDC now and SAML later?
- **Q3 Disclosure form.** Should we use a text prefix (works with today's per-employee user token) or a Slack bot identity (needs a Slack app and a bot token per workspace)?
- **Q4 "Entitled to the data".** No org access-rule model exists. The proposal is that the auto-reply allowlist is the rule, and auto-replies use only the twin's non-confidential profile files and no tools.

## Status (2026-10-21)

All 20 plan steps are implemented on `main`; see the CHANGELOG `[Unreleased]` entry. The test suite grew from 343 to 462 tests. Deferred or partial:

- **SAML**: not built (decision Q2). OIDC covers Google Workspace, Entra ID, Okta, Auth0 and Keycloak.
- **Data classification**: auto-replies use a fixed list of non-confidential profile files (decision Q4), not a full access model.
- **Composio user id**: still `employee:<slug>`, so it is name-derived. Changing it needs every connection re-made, so it is a follow-up.
- **First-name mentions**: deletion redacts id and full name only.
- **Tenancy**: `tenantId` is one value per install (`EMPLOYEE001_TENANT_ID`). This is not multi-tenant isolation.
