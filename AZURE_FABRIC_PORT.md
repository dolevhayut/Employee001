# Employee001 → Microsoft Stack Port

**Status:** Active overnight rewrite (started 2026-06-02 by Hermes Agent for Roey).
**Branch:** `roy2392/azure-fabric-swap` on fork `ZaltaClaw/Employee001`.
**Bar:** real product, no mocks, every button works. When done, push branch + open PR upstream → print `PR_URL: <url>` exactly once.

## Goal

Replace the Anthropic + Composio stack with a 100%-Microsoft stack while preserving every Employee001 feature (council meetings, twin chats, audit, org brain, marketplace, invites, focus mode, etc.).

| Layer            | OUT (current)                                  | IN (target)                                      |
| ---------------- | ---------------------------------------------- | ------------------------------------------------ |
| Reasoning model  | `@anthropic-ai/claude-agent-sdk` (Claude)      | Azure OpenAI gpt-4o (deployment `gpt-4o`) via `openai` Node SDK with Azure config |
| Tool layer       | Composio MCP (Slack, Linear, GitHub, Gmail…)   | Microsoft Graph MCP server (Teams, Outlook, OneDrive, Planner, ToDo, SharePoint) |
| Per-user OAuth   | Composio managed auth                          | MS Graph delegated OAuth — device code flow      |
| Persistent data  | `./data/` JSON files (profiles, audit, brain)  | Microsoft Fabric Lakehouse Delta tables (OneLake) — abstracted behind a `Storage` interface so local-JSON fallback still works for dev |
| Voice            | ElevenLabs                                     | Azure Speech (Cognitive Services Speech SDK)     |

## Pre-provisioned Azure resources (DO NOT recreate)

Loaded from `.azure-secrets/.env.azure` (gitignored):

```
AZURE_TENANT_ID=51e81f3f-02ee-4f69-b895-afdb90e12026
AZURE_CLIENT_ID=89839864-3043-413a-91e7-74a5d989a14d   # Entra app reg "Employee001-Azure-Fabric"
AZURE_CLIENT_SECRET=<set>                              # 1y, in .env.azure
AZURE_OPENAI_ENDPOINT=https://agent-builder-foundry.cognitiveservices.azure.com/
AZURE_OPENAI_DEPLOYMENT=gpt-4o                         # gpt-4o deployment (gpt-5.1 model under it)
AZURE_OPENAI_API_VERSION=2024-10-21
# Local-auth disabled on the Foundry — use DefaultAzureCredential (azidentity).
# SP 6654892e-eb72-49fe-958a-e96466bc96e0 has "Cognitive Services OpenAI User" on the Foundry.
FABRIC_WORKSPACE_ID=bcf06cc7-1677-4195-ae7d-2e1a6087ffdb     # workspace "employee001"
FABRIC_LAKEHOUSE_ID=1aedbb9f-d6d9-484f-ad16-2cbd21454a25     # lakehouse "lh_employee001"
FABRIC_ONELAKE_PATH=https://onelake.dfs.fabric.microsoft.com/employee001/lh_employee001.Lakehouse/Files
```

Capacity: F32 `fc25lq6rhm2vqg4` (rg-confluenceetl, West US 3) — currently Active.

## Microsoft Graph delegated permissions on the Entra app

Already added (no admin consent needed — user-consentable on first device-code login):

- User.Read
- Mail.ReadWrite, Mail.Send
- Files.ReadWrite.All (OneDrive/SharePoint)
- Tasks.ReadWrite (Planner / ToDo)
- ChannelMessage.Send, Chat.ReadWrite (Teams)
- offline_access (refresh tokens)

App is configured with `isFallbackPublicClient=true` for device-code auth.

## File-by-file plan

### Phase 1 — Adapters (touch carefully, preserve API shape)

1. **`src/lib/llm-client.ts`** (NEW) — thin wrapper around `openai` Node SDK with Azure mode. Exports `streamChat(messages, tools)` returning the same async-iterator shape Anthropic's `query()` returns. Auth: `DefaultAzureCredential().getToken("https://cognitiveservices.azure.com/.default")` → bearer token; refresh on 401.

2. **`src/lib/graph-client.ts`** (NEW, replaces `src/lib/composio-client.ts`) — uses `@microsoft/microsoft-graph-client` + `@azure/msal-node` (DeviceCodeCredential or PublicClientApplication.acquireTokenByDeviceCode). Per-employee token cache stored in Fabric `tokens` table (or `data/employees/{id}/.graph.json` in dev fallback). Same exported surface as composio-client (`buildEmployeeMcpServer`, `connectToolkit`, `disconnectToolkit`, `listConnections`).

3. **`src/lib/graph-mcp.ts`** (NEW) — defines an in-process MCP server (using `createSdkMcpServer` from claude-agent-sdk OR a vanilla `@modelcontextprotocol/sdk` server) exposing tools:
   - `outlook_send_mail`, `outlook_search_mail`, `outlook_create_event`
   - `teams_post_channel_message`, `teams_send_chat`
   - `onedrive_upload`, `onedrive_search`, `sharepoint_list_files`
   - `planner_create_task`, `planner_list_tasks`, `todo_create_task`
   - `graph_search_org` (people search across the tenant)
   Each tool calls Graph as the connected user.

4. **`src/lib/sdk-sessions.ts`, `src/lib/sdk-defaults.ts`, `src/lib/council-runner.ts`, `src/lib/twin-subagents.ts`, `src/lib/shift-runner.ts`** — replace `query()` from claude-agent-sdk with our `streamChat()`. Keep system prompts, the council orchestration, the streaming, the audit emission. The Anthropic SDK's `query()` yields events; we yield the same event shape from gpt-4o's tool-calling stream so downstream code is unchanged.

5. **`src/lib/composio-client.ts`** — keep file but turn it into a re-export/shim of `graph-client.ts` so any leaked imports still work.

### Phase 2 — Storage layer (Fabric)

6. **`src/lib/storage/index.ts`** (NEW) — abstract `Storage` interface: `getEmployees`, `saveEmployee`, `appendAudit`, `readBrain`, `writeBrain`, etc. Two implementations:
   - `LocalJsonStorage` (current `./data/` behavior — dev fallback)
   - `FabricLakehouseStorage` — writes Parquet/Delta files directly to OneLake via the `@azure/storage-file-datalake` SDK against `FABRIC_ONELAKE_PATH`, using the SP credentials. Reads via the SQL endpoint (`mssql` Node driver) for queries. Tables: `employees`, `connections`, `audit_log`, `org_brain_documents`, `council_runs`, `tokens`.

7. Wire all `data/` reads/writes in `src/lib/ex-data.ts`, `src/lib/twin-memory.ts`, `src/lib/org-brain-builder.ts`, `src/app/api/audit/*`, `src/app/api/org/*` through the `Storage` interface. Selection by `STORAGE_BACKEND=fabric|local` env.

### Phase 3 — Voice + setup

8. **`src/lib/voice.ts`** — replace ElevenLabs with Azure Speech (`microsoft-cognitiveservices-speech-sdk`). Same exported `synthesize(text, voice)` shape.

9. **`bin/cli.mjs` setup wizard** — add Azure prompts (validate the foundry endpoint reachable, acquire device code for first-user login, write to `.env`).

### Phase 4 — Validation

10. Run `npm install`, `npm run build`, `npm run lint`. Fix anything red.
11. Start `next dev` against `STORAGE_BACKEND=fabric`. Smoke-test:
    - Create one employee twin via the UI.
    - Connect Outlook + Teams via device code.
    - Run a 2-twin council meeting that sends a real Teams message AND drafts a real Outlook email AND creates a Planner task.
    - Verify rows land in the Fabric lakehouse tables.
12. Commit, push to `fork`, open PR upstream `dolevhayut/Employee001`, **print `PR_URL: <url>` on its own line at the very end**.

## Hard rules

- **No mocks.** Every tool call must actually hit Microsoft Graph or Azure OpenAI.
- **No deletions of features.** If you can't port something cleanly, leave it behind a feature flag and note it in the PR body — don't drop it.
- **Preserve TypeScript types and `.env.example`.** Update `.env.example` with the new Azure vars.
- **Local-first promise still holds:** `STORAGE_BACKEND=local` should still work with no Azure access; that's the dev fallback.
- **Capacity discipline:** when finished, suspend `fc25lq6rhm2vqg4` via `az fabric capacity suspend -g rg-confluenceetl -n fc25lq6rhm2vqg4`. F32 is $5.78/hr.
- **End signal:** literally print `PR_URL: <https-github-url>` as the last line. The Hermes watcher greps for that and pings Roey.

## Useful commands

```bash
# Foundry token for testing
az account get-access-token --resource https://cognitiveservices.azure.com --query accessToken -o tsv

# Smoke-test gpt-4o
ENDPOINT=https://agent-builder-foundry.cognitiveservices.azure.com
TOKEN=$(az account get-access-token --resource https://cognitiveservices.azure.com --query accessToken -o tsv)
curl -s -X POST "$ENDPOINT/openai/deployments/gpt-4o/chat/completions?api-version=2024-10-21" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"say hi"}],"max_tokens":20}' | jq

# OneLake list
az storage fs file list --account-name onelake --file-system employee001 \
  --path "lh_employee001.Lakehouse/Files" --auth-mode login -o table

# Fabric workspace items
TOKEN=$(az account get-access-token --resource https://api.fabric.microsoft.com --query accessToken -o tsv)
curl -s -H "Authorization: Bearer $TOKEN" \
  https://api.fabric.microsoft.com/v1/workspaces/bcf06cc7-1677-4195-ae7d-2e1a6087ffdb/items | jq
```
