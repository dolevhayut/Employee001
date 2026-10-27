# Where your data goes (DRAFT outline)

> **Status: draft. Do not link from the README hero and do not publish.** Hold until tsk_hv8dyqhfmh has a recorded attack run and a signed-in/out check (task #1216, AC4). Every claim below cites the file and line it is true in, read 2026-10-27. Re-check the line numbers before publishing; they move.

## 1. Stored on your machine

- Data lives under `data/` inside the app home, which is `EMPLOYEE001_HOME` if set, otherwise the current working directory. Source: `src/lib/app-home.ts:11-18`.
- `./data/` holds profiles, memory, audit logs, accounts and org knowledge. Source: `SECURITY.md:15`.
- Local folders: up to five per twin. Source: `src/lib/knowledge-folder-shared.ts:4`.
- `.env` files, keys, `.git` and `node_modules` are never read. Source: `CHANGELOG.md:17-18`; name filter `src/lib/knowledge-folders.ts:42`; search exclusions `src/lib/knowledge-folders.ts:48`.
- Folder paths are resolved with `realpath`. Source: `src/lib/knowledge-folders.ts:132`, `:156`.
- `.ssh`, `.claude`, `.aws`, `.config`, `.gnupg`, `.kube`, `.docker`, `.azure` and `.gcloud` in the home folder are on the blocked list. Source: `src/lib/knowledge-folders.ts:69`.
- Every folder add and remove is written to the hash-chained audit log. Source: `src/lib/knowledge-folders.ts:183-184` (comment), `appendAuditEntry` at `:193-203`, calls at `:225` and `:240`.

## 2. Sent to your model provider

- Files a twin reads from a folder are sent to your model provider to answer. Source: `src/lib/knowledge-folder-shared.ts:8-9` (the consent line on the add-folder controls).
- What goes: the question, the twin's profile files, recalled memory, org-brain excerpts, tool results, meeting transcripts. Source: `SECURITY.md:23`.
- Who receives it, by configuration: Anthropic; Amazon Bedrock, Google Vertex AI or Azure AI Foundry; or a local model. Source: `SECURITY.md:23-25`.
- Meeting summaries, memory rerank and knowledge proposals call the Anthropic API directly and are off on other providers unless `EMPLOYEE001_ALLOW_DIRECT_ANTHROPIC=1`. Source: `README.md:245` (table row).
- `npx employee001 doctor --egress` prints the hosts for your configuration. Source: `SECURITY.md:15`.

## 3. Sent to tools you connect

- Composio receives OAuth tokens and every tool call's inputs and outputs when `COMPOSIO_API_KEY` is set and a tool is connected. Source: `SECURITY.md:26`.
- A custom MCP server receives its tool calls, including read query content, once enabled in Settings. Source: `SECURITY.md:32`.
- OpenAI receives memory-card text for embeddings only when `OPENAI_API_KEY` is set, `TWIN_MEMORY_ENABLED` is not `false` and `EMBEDDINGS_BASE_URL` is not set; off in EU mode. Source: `SECURITY.md:27`.
- ElevenLabs receives the twin's answer text and microphone audio when `ELEVENLABS_API_KEY` is set and voice is used. Source: `SECURITY.md:28`.

## 4. Telemetry

- Off by default; sends nothing unless turned on in Settings. Source: `SECURITY.md:37`.
- Consent is true only when stored as true. Source: `src/lib/telemetry.ts:60`, `:65`.
- Sending needs consent, an install id, a destination (`EMPLOYEE001_TELEMETRY_URL`) and a 24-hour gap. Source: `src/lib/telemetry.ts:89-93`, `:155-158`.
- The payload is `active_twins`, `meetings_7d`, `approvals_7d`, plus version, Node major, OS and `install_id` when present. Source: `src/lib/telemetry.ts:32-45`, `:139-145`.

## Not yet verified (left out of the draft)

1. **Retention and deletion.** How long data is kept or how it is deleted, here or at any provider. Out until the CEO approves wording. (`SECURITY.md:140` has a deletion section; it is not restated here.)
2. **Attack-run results.** What the attack run found, and any "provably safe" wording. No run is recorded yet (tsk_hv8dyqhfmh).
3. **Signed-in vs signed-out check.** Not done yet.
4. **`Grep` scope in folders.** `CHANGELOG.md` says `Grep` there works one file at a time, but commit 952f3fc ("twins can Grep a whole folder, with secrets left out") changed that. The CHANGELOG line needs fixing before any Grep claim is made. None is used above.
5. **What happens to prompts under a Claude subscription.** That is Anthropic's own terms; not described here.
6. **"No telemetry endpoint is configured out of the box."** README says so; this draft only cites the env-var gate (`src/lib/telemetry.ts:155`).
7. **Other recipients:** browser speech recognition, Slack, OIDC, web fetches, hosting provider, update checks (`SECURITY.md:29-35`). Not outlined here.
8. **A terminal screenshot of `npx employee001`.** None exists in `docs/screenshots`, so hero step 1 shows the command as text, not an image (AC1 asks for one per step).
