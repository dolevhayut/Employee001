# Releasing Employee001

Cutting a release is just a tag push. The `.github/workflows/release.yml` workflow handles the rest.

## One-time setup (maintainer only)

1. Generate a **Granular Access Token** at https://www.npmjs.com/settings/<user>/tokens with:
   - Permissions: **Read and write**
   - Packages and scopes: **Only select packages → `employee001`**
   - **Allow bypassing 2FA when publishing**: ✅ checked (the workflow can't prompt for OTP)
2. Add it as `NPM_TOKEN` under **Settings → Secrets and variables → Actions** on the GitHub repo.

That's it. `GITHUB_TOKEN` is provided automatically.

## Cutting a release

1. **Bump `version` in `package.json`** — follow [semver](https://semver.org/). Patch for fixes, minor for features, major for breaking changes.
2. **Commit and push to `main`**:
   ```bash
   git commit -am "release: vX.Y.Z"
   git push
   ```
3. **Tag and push the tag**:
   ```bash
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```
4. **Watch the workflow** under the Actions tab. It will:
   - Verify the tag matches `package.json#version` (fails fast if they drift)
   - `npm ci && npm run lint && npm run build`
   - Verify the standalone artifacts exist
   - `npm publish --provenance --access public`
   - `gh release create` with auto-generated notes from commits since the last tag

## If something goes wrong

- **Tag mismatch:** delete the tag, bump `package.json`, re-tag, re-push.
  ```bash
  git tag -d vX.Y.Z
  git push --delete origin vX.Y.Z
  ```
- **npm publish failed but GitHub release was created:** delete the GitHub release in the UI, fix the underlying issue, re-tag.
- **Already published to npm but the release is broken:** publish a patch (`vX.Y.Z+1`). npm versions are immutable. Don't unpublish — it breaks existing `npx employee001@X.Y.Z` invocations.

## Pre-release checklist

Run locally before tagging:

```bash
npm run lint
npm run build
node bin/cli.mjs doctor
npm pack --dry-run    # eyeball the file list
```

If any of those fail or print surprises, fix them before tagging.
