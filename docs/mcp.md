# Use Employee001 from Claude Code, Cursor and other MCP clients

Ask your org's twins from the editor. Employee001 makes the local organizational brain available as an MCP server. Use it to find a colleague's decisions, search shared knowledge, inspect the current session, or ask a ready twin a focused question.

Start Employee001 before connecting a client:

```bash
npx employee001 start
```

The server is local only. The default endpoint is:

```
http://127.0.0.1:3000/api/mcp
```

## Set up a client

### Claude Code

Run this in the project where you use Claude Code:

```bash
claude mcp add employee001 -- npx employee001 mcp
```

The `employee001 mcp` command is a stdio bridge. It forwards MCP requests to the running local app. To use another local port or endpoint, add `--url`:

```bash
npx employee001 mcp --url http://127.0.0.1:3001/api/mcp
```

### Cursor

Create or update `.cursor/mcp.json` in your project:

```json
{
  "mcpServers": {
    "employee001": {
      "command": "npx",
      "args": ["employee001", "mcp"]
    }
  }
}
```

Restart Cursor or reload its MCP servers after saving the file.

### Claude Desktop

Open Claude Desktop's MCP configuration file and add Employee001 under `mcpServers`:

```json
{
  "mcpServers": {
    "employee001": {
      "command": "npx",
      "args": ["employee001", "mcp"]
    }
  }
}
```

On macOS, the file is usually `~/Library/Application Support/Claude/claude_desktop_config.json`. Restart Claude Desktop after changing it.

### Clients with Streamable HTTP

If your client supports Streamable HTTP, point it directly at:

```
http://127.0.0.1:3000/api/mcp
```

Use the client’s normal MCP HTTP configuration. The endpoint is stateless and returns JSON-RPC responses.

For example, this lists the available tools:

```bash
curl -s http://127.0.0.1:3000/api/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## Tools

Use read tools before asking a twin. They are fast and do not run a model. All list and get results are pretty-printed JSON in one MCP text block. Tool errors are returned as MCP tool errors, not thrown protocol errors.

### `list_twins`

Use this to see who is available before you ask a question.

Input:

```json
{}
```

Output: an array sorted by name. Each item has `id`, `name`, `firstName`, `role`, optional `department`, and `status`.

Example:

```json
[
  {
    "id": "maya",
    "name": "Maya Cohen",
    "firstName": "Maya",
    "role": "Product Lead",
    "department": "Product",
    "status": "ready"
  }
]
```

### `get_twin_profile`

Use this to read the source files behind a colleague’s expertise and decisions before you build.

Input:

```json
{
  "twinId": "maya",
  "files": ["EXPERTISE.md", "DECISIONS.md"]
}
```

`twinId` is required. `files` is optional. When omitted, Employee001 returns all nine base profile files: `EXPERTISE.md`, `TONE.md`, `CONTEXT.md`, `DECISIONS.md`, `PREFERENCES.md`, `PEOPLE.md`, `PROJECTS.md`, `BOUNDARIES.md`, and `EMPLOYMENT.md`. Each file is capped at 16 KB and has a truncation marker when needed.

Output: `{ id, name, role, files }`, where `files` maps file names to their markdown body.

Example:

```json
{
  "id": "maya",
  "name": "Maya Cohen",
  "role": "Product Lead",
  "files": {
    "DECISIONS.md": "# Decisions\n\nUse annual contracts for enterprise customers."
  }
}
```

### `search_org_brain`

Use this first to find what a colleague decided or owns without spending money on a model call.

Input:

```json
{
  "query": "enterprise pricing decision",
  "source": "maya",
  "file": "DECISIONS.md",
  "limit": 6
}
```

`query` is required and must contain 2–200 characters. `source` and `file` are optional filters. `limit` is optional, defaults to 6, and accepts 1–20.

Output: `[{ source, file, heading, snippet, score }]`.

Example:

```json
[
  {
    "source": "maya",
    "file": "DECISIONS.md",
    "heading": "Pricing",
    "snippet": "Enterprise plans use annual contracts with a paid pilot.",
    "score": 0.91
  }
]
```

### `list_pending_approvals`

Use this to check work that needs a human decision. It does not approve, reject, or change anything.

Input:

```json
{}
```

Output: `[{ id, employeeId, toolName, summary, surface, createdAt }]`. The summary is limited to 200 characters and never includes raw tool input.

Example:

```json
[
  {
    "id": "apr_abc123",
    "employeeId": "maya",
    "toolName": "slack_send_message",
    "summary": "Send the launch update to #product.",
    "surface": "chat",
    "createdAt": 1791162000000
  }
]
```

### `list_team_meetings`

Use this to find Team Meetings from the current Employee001 process. Meetings are in memory and disappear when the app restarts.

Input:

```json
{}
```

Output: `[{ id, participantIds, turns, createdAt, updatedAt }]`, newest first.

Example:

```json
[
  {
    "id": "meeting_launch",
    "participantIds": ["maya", "arie"],
    "turns": 8,
    "createdAt": 1791162000000,
    "updatedAt": 1791162300000
  }
]
```

### `get_team_meeting`

Use this to read a current Team Meeting before you make a related change.

Input:

```json
{
  "meetingId": "meeting_launch"
}
```

Output: `{ id, participantIds, transcript, sharedFiles }`. `sharedFiles` contains `{ name, summary?, author? }`. The transcript is capped at 64 KB; when trimmed, the response also includes `truncated: true` and `turnsOmitted`, and keeps the latest turns.

Example:

```json
{
  "id": "meeting_launch",
  "participantIds": ["maya", "arie"],
  "transcript": "Maya: Stage the launch.\n\nArie: Add a rollback test first.",
  "sharedFiles": [{ "name": "launch-checklist.md", "author": "maya" }]
}
```

### `ask_twin`

Use this only after `search_org_brain` when you need a concise, grounded answer from a ready twin. It costs money: at most **$0.50 per call**, usually takes **10–60 seconds**, and counts against that twin’s daily budget.

Input:

```json
{
  "twinId": "maya",
  "question": "What did you decide about enterprise pricing, and why?"
}
```

`question` must contain 1–4,000 characters. The response is answer-only. The twin cannot write files, browse the web, run tasks, call connected tools, or wait for an approval.

Output: plain text in this form:

```text
Maya (Product Lead) says:

We chose annual contracts with a paid pilot because procurement needs a clear budget cycle.
```

Employee001 permits 20 `ask_twin` calls per rolling hour across the local server. Only one call for the same twin can run at a time.

To hide this tool completely, start Employee001 with:

```bash
EMPLOYEE001_MCP_ASK_TWIN=off npx employee001 start
```

## Errors and limits

Tool errors have this shape:

```json
{
  "error": "not_found",
  "message": "The requested twin does not exist."
}
```

| Code           | Meaning                                                         |
| -------------- | --------------------------------------------------------------- |
| `not_found`    | The requested twin or meeting does not exist.                   |
| `not_ready`    | The twin exists but is not ready to answer.                     |
| `over_budget`  | The twin does not have $0.50 left in its daily budget.          |
| `rate_limited` | The server has reached 20 `ask_twin` calls in the rolling hour. |
| `busy`         | An `ask_twin` call for this twin is already running.            |
| `disabled`     | `ask_twin` is disabled with `EMPLOYEE001_MCP_ASK_TWIN=off`.     |
| `bad_request`  | The tool input is invalid.                                      |
| `internal`     | Employee001 could not complete the request.                     |

The HTTP endpoint can also return JSON-RPC errors before a tool runs:

| Error    | Meaning                                                                                                                       |
| -------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `-32001` | MCP is loopback-only in this version.                                                                                         |
| `-32002` | The stdio bridge could not reach Employee001. It reports: `Employee001 is not running. Start it with: npx employee001 start`. |
| `-32003` | The request has a forbidden host or origin.                                                                                   |

Every MCP tool call is recorded in Employee001's local audit log. Question and query previews are limited to 120 characters in that entry.

## Local-only security and process model

MCP is intentionally loopback-only in this version. Employee001 rejects a non-loopback `EMPLOYEE001_BIND`. It also accepts only `127.0.0.1`, `localhost`, or `[::1]` in the HTTP `Host` header, and rejects browser origins outside those local hosts. This protects the local endpoint from DNS rebinding and browser cross-site requests.

Run Employee001 as one local Node process. MCP rate limits, in-flight calls, Team Meetings, and pending approvals are process-local. Restarting the app clears meetings and in-memory request state.

Do not expose `/api/mcp` through a public tunnel, reverse proxy, or network interface. Remote authentication is not part of this release.

## Troubleshooting

### “Employee001 is not running”

Start the app in another terminal, then retry your client:

```bash
npx employee001 start
```

The bridge expects `http://127.0.0.1:3000/api/mcp` by default. If your app runs on another port, use the matching URL:

```bash
npx employee001 mcp --url http://127.0.0.1:3001/api/mcp
```

### The client cannot see `ask_twin`

Check that Employee001 was not started with `EMPLOYEE001_MCP_ASK_TWIN=off`. Restart the MCP client after changing the environment.

### A twin cannot answer

Run `list_twins` and confirm its `status` is `ready`. Use `search_org_brain` or `get_twin_profile` if the twin is still training or if you only need the recorded context.
