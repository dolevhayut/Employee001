---
name: release
description: >-
  Cut an npm release of the `employee001` package — bump the version, push the
  vX.Y.Z tag that triggers .github/workflows/release.yml, then watch the run and
  verify npm + the GitHub Release. USE WHEN the user says "release", "ship it",
  "publish to npm", "cut a version", "bump the version", "תוציא גרסה", "תשחרר",
  or wants users running `npx employee001` to get recent changes. Encodes the
  cadence rule: commits/pushes to main are free (CI only) — only a vX.Y.Z tag
  publishes, so batch many commits into one release. Do NOT release on every commit.
---

# Release `employee001` to npm

## Cadence rule — read this first

Pushing to `main` does **not** publish. The two triggers are decoupled:

| Action | Workflow | Effect |
|---|---|---|
| `git push origin main` (no tag) | `ci.yml` | Lint + build only. **No npm publish.** |
| `git push --follow-tags` with a `vX.Y.Z` tag | `release.yml` | Build → leak-scan → `npm publish --provenance` → GitHub Release |

So: **commit and push freely all day; release only when you choose.** Batch many
commits into ONE release. Never bump a version per-commit — that's churn. Release
when enough user-facing change has accumulated, when fixing a bug that affects
installed users, or before an event (post/demo) that needs the new code live.

If the user just wants their work saved, that's a commit+push, NOT this skill.
Only run the release flow when they explicitly want to publish.

## Preflight gates (all must pass before tagging)

Run these and STOP if any fails — surface the problem to the user, don't force it.

```bash
cd "$(git rev-parse --show-toplevel)"
git branch --show-current                      # must be: main
git status --short                             # must be EMPTY (clean tree)
git rev-list --left-right --count origin/main...HEAD   # must be "0  0" (in sync)
npx tsc --noEmit; echo "tsc exit=$?"           # must be exit 0
node -p "require('./package.json').version"    # current version (sanity)
```

- **Not on main / dirty tree / behind origin** → resolve first (commit, push, or
  `git pull`). Never tag off a dirty or out-of-sync tree.
- **tsc errors** → fix them; a red typecheck means `release.yml`'s build will fail.
- A push to `main` happens implicitly via `--follow-tags` below, so make sure the
  commits you want shipped are already committed and pushed (or will go with the tag).

## Choose the bump

Ask the user (or infer from intent) — `patch` is the default for fixes/small features:

- `patch` — bug fixes, small UI/UX improvements (0.1.2 → 0.1.3)
- `minor` — new user-facing features (0.1.x → 0.2.0)
- `major` — breaking changes (0.x → 1.0.0)

## Cut the release

```bash
npm version <patch|minor|major> --ignore-scripts -m "release: v%s"
git push origin main --follow-tags
```

- `--ignore-scripts` skips the `preversion`/`postversion` hooks so the push is
  explicit and predictable (this is the project's chosen flow).
- `npm version` commits the bump and creates the `vX.Y.Z` tag; `--follow-tags`
  pushes both the commit and the tag. The tag is what fires `release.yml`.

## Watch + verify

```bash
# Find and watch the Release run
RID=$(gh run list --workflow=release.yml --limit 1 --json databaseId -q '.[0].databaseId')
gh run watch "$RID" --exit-status

# After it completes — verify the publish landed
NEWV=$(node -p "require('./package.json').version")
npm view employee001 version dist-tags          # latest must == $NEWV
gh release list --limit 1                        # vX.Y.Z marked "Latest"

# Leak check the published tarball (must show NONE)
npm pack "employee001@$NEWV" --dry-run --json 2>/dev/null | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const f=(JSON.parse(d)[0].files||[]).map(x=>x.path);const leak=f.filter(p=>/^data\//.test(p)||p==='.env');console.log('files:',f.length,'| leak:',leak.length?leak.join(', '):'NONE ✅')})"
```

Report to the user: new version live on npm (`latest`), GitHub Release created,
leak check clean. If anything is red, see Failure modes.

## Failure modes (learned the hard way)

- **`npm error 400 — Cannot publish over previously published version`** — that
  version number is permanently retired (npm tombstones an unpublished version;
  `npm view ... versions` does NOT list it, so the slot only *looks* open). **Do
  not retry the same number.** Bump to the next one and re-tag. Recovering the old
  number needs an npm support ticket.
- **Release build fails on lint/build** — the preflight `tsc` should have caught
  type errors; for lint, run `npm run lint` locally, fix, recommit, and re-tag a
  fresh patch (a tag can't be moved cleanly once pushed — bump again).
- **`npm view` still shows the old version right after success** — registry
  propagation lag; wait a few seconds and re-check before declaring a problem.

## Supply-chain note

This skill publishes OUR package — the 7-day "don't consume fresh npm versions"
rule (see `docs/SECURITY-SHAI-HULUD.md`) does not apply to publishing. But never
run `npm install`/`npm update` as part of a release to pull in fresh deps; release
from the lockfile that CI already validated.
