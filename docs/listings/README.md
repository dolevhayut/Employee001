# Listing drafts: MCP registry, Claude Code plugin, directories

Ready-to-submit drafts. **Nothing here is published yet.** Each step below is an outward-facing action that needs Dolev's go-ahead.

Order matters: the registry checks the npm package, so the release comes first.

| # | Where | What it gets us | Needs |
|---|---|---|---|
| 1 | npm release with `mcpName` | Prerequisite for the registry; also ships the bridge's env-var token support | A release after 0.7.0 |
| 2 | Claude Code plugin marketplace (this repo) | `/plugin install employee001 --marketplace dolevhayut/Employee001` works for everyone | Merge to `main` |
| 3 | Official MCP Registry | Canonical listing; downstream directories and clients read from it | Step 1, a GitHub login as `dolevhayut` |
| 4 | Anthropic plugin directory | Discovery inside Claude Code and claude.ai | Step 2, a paid claude.ai plan |
| 5 | awesome-mcp-servers | One of the most-read MCP lists on GitHub | A PR from Dolev's account |

---

## 1. Ship `mcpName` in an npm release

`package.json` now has `"mcpName": "io.github.dolevhayut/employee001"`. The registry fetches the published `package.json` for the version named in `server.json` and rejects the listing if `mcpName` is missing or different. 0.7.0 does not have it.

1. Cut the next release as usual (see `CLAUDE.md` → Releasing).
2. If that release is not `0.7.1`, set both `version` fields in [`mcp-registry/server.json`](./mcp-registry/server.json) to the released version. The registry rejects ranges and `latest`.
3. Check it shipped:

   ```bash
   npm view employee001@0.7.1 mcpName
   ```

   Expected output: `io.github.dolevhayut/employee001`.

## 2. Plugin marketplace (this repo)

[`.claude-plugin/marketplace.json`](../../.claude-plugin/marketplace.json) at the repo root makes the repo a Claude Code marketplace named `employee001`, serving [`plugins/claude-code`](../../plugins/claude-code). Merging this branch to `main` of the public repo is the publish step: from then on anyone can run:

```text
/plugin install employee001 --marketplace dolevhayut/Employee001
```

Before merging:

```bash
claude plugin validate . --strict
```

```bash
claude plugin validate plugins/claude-code --strict
```

After merging, check from any folder:

```bash
claude plugin marketplace add dolevhayut/Employee001
```

```bash
claude plugin install employee001@employee001 --scope local
```

Bump `version` in `plugins/claude-code/.claude-plugin/plugin.json` whenever the skills change. Installed copies only update when it changes.

## 3. Official MCP Registry

Draft: [`mcp-registry/server.json`](./mcp-registry/server.json). It is validated against the `2025-12-11` schema. The name `io.github.dolevhayut/employee001` requires GitHub auth as `dolevhayut`.

1. Install the publisher:

   ```bash
   brew install mcp-publisher
   ```

2. Log in with GitHub (opens a device-code flow):

   ```bash
   mcp-publisher login github
   ```

3. Publish from the folder that holds `server.json`:

   ```bash
   cd docs/listings/mcp-registry && mcp-publisher publish
   ```

4. Verify:

   ```bash
   curl -s "https://registry.modelcontextprotocol.io/v0/servers?search=io.github.dolevhayut/employee001"
   ```

For each later release, bump both `version` fields and run `mcp-publisher publish` again.

## 4. Anthropic plugin directory

Submit at <https://claude.ai/directory/manage> (needs a paid claude.ai plan). Run Anthropic's pre-submission checklist first: <https://claude.com/docs/plugins/pre-submission-checklist>.

Draft fields:

- **Name:** Employee001
- **Source:** `dolevhayut/Employee001`, marketplace `employee001`, plugin `employee001`
- **Short description:** Ask your company's AI twins from Claude Code: ask the company, ask one colleague, or convene a team meeting.
- **Long description:** Employee001 is an open-source, self-hosted app of AI twins grounded in your real colleagues' profiles and decisions. This plugin connects Claude Code to your own instance. `/employee001:ask-company` searches the org brain and the 1–3 colleagues who own a topic and writes one cited answer. `/employee001:ask-twin` asks one colleague's twin. `/employee001:team-meeting` runs two rounds between 2–3 twins and writes the minutes. Claude also checks what the team decided before it builds. Read tools are free. Asking a twin costs up to $0.50, asks for permission, and is rate-limited and audited by your instance. Nothing goes anywhere except your own Employee001.
- **Category:** Productivity
- **Requirements:** a running Employee001 (`npx employee001 start`), Node 22+
- **Homepage:** https://employee001.com
- **Support:** https://github.com/dolevhayut/Employee001/issues
- **License:** MIT

## 5. awesome-mcp-servers

Repo: <https://github.com/punkpeye/awesome-mcp-servers>. Add one line under **🧠 Knowledge & Memory**, in alphabetical order. Legend: 📇 TypeScript, 🏠 local service, 🍎 macOS, 🐧 Linux. Windows is untested, so leave out 🪟.

```markdown
- [dolevhayut/Employee001](https://github.com/dolevhayut/Employee001) 📇 🏠 🍎 🐧 - Self-hosted AI twins of your real colleagues. Search what the team decided and who owns what, or ask a colleague's twin, with per-call cost limits and an audit log.
```

PR title: `Add Employee001`. Many entries also carry a Glama score badge. That needs the server listed on glama.ai first, and it is optional.
