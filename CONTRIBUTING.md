# Contributing to Employee001

Thanks for considering a contribution. Employee001 is a local-first, MIT-licensed AI workforce app, and outside help is welcome.

## Ground rules

1. **No telemetry. No analytics. No phone-home.** PRs that add tracking, beacons, Sentry, or any code that sends data anywhere other than the Anthropic and Composio APIs the user opted into will be closed.
2. **No paid feature gates, no license-key checks, no DRM.** Premium is services, not code. If you find yourself adding `if (license.tier === "pro")`, stop.
3. **No cloud dependencies beyond Anthropic and Composio.** Everything else lives on the user's machine.
4. **Don't burn real personal info into source.** The exception is the explicitly opt-in `DEMO_TWINS` array in `src/lib/employees.ts`.
5. **Don't commit secrets.** The repo has a sync-script secret scanner; don't bypass it.

If a feature can't be built within these rules, open a discussion first — happy to talk it through.

## Quick start

```bash
git clone https://github.com/dolevhayut/Employee001.git
cd Employee001
npm install
cp .env.example .env  # fill in keys, or run `node bin/cli.mjs setup`
npm run dev           # http://localhost:3000
```

Requires Node.js 22+.

### Useful commands

| Command | What it does |
|---|---|
| `npm run dev` | Next.js dev server with HMR |
| `npm run build` | Production build + `scripts/post-build.mjs` to assemble `.next/standalone/` |
| `npm run lint` | ESLint |
| `node bin/cli.mjs doctor` | Health check — Node, env, keys, port, build |
| `node bin/cli.mjs start` | Run the built standalone server (needs `npm run build` first) |

## How to propose a change

1. **Open an issue first** for anything non-trivial. Aligning on shape before code saves both sides time.
2. **Branch from `main`.** Use a short topic name: `fix/proxy-cookie-edge`, `feat/cli-update-self`, etc.
3. **Keep the PR focused.** One concern per PR. If you find drive-by cleanups, mention them in the description but resist bundling them in.
4. **Verify locally before opening the PR.** At minimum:
   ```bash
   npm run lint
   npm run build
   node bin/cli.mjs doctor
   ```
5. **Document what changed.** Update README, `.env.example`, or inline comments when behavior, env vars, or the CLI surface changes.

## What we welcome

- Bug fixes (especially around the CLI, build pipeline, and local data layer)
- Better error messages
- Documentation, typos, clarifying examples
- Docker / Electron / DMG packaging (open follow-up #7)
- Test coverage (the project ships with `promptfoo` for twin evals; full unit tests are an open question)

## What's currently out of scope

- A hosted SaaS version
- Authentication beyond the localhost binding + shared-secret token model
- A migration to SQLite / Drizzle / Prisma (deferred until JSON file I/O actually hurts)
- Multi-tenant features

## Code style

- TypeScript strict mode, no `any` unless genuinely necessary and commented.
- Prefer **simple** over **clever**. Three similar lines beat a premature abstraction.
- Comments explain **why**, not **what** — well-named identifiers do the "what."
- No new dependencies without justification in the PR description. The dependency list is a security surface; we keep it tight.

## Filing a security issue

Don't open a public issue for a security vulnerability. Email **office@bulldog-adv.com** with details and a proof-of-concept if possible. We'll acknowledge within a few business days.

## License

By contributing, you agree your contribution is licensed under the [MIT License](./LICENSE).
