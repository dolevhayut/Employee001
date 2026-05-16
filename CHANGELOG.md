# Changelog

All notable changes to Employee001 are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

---

## [0.1.0-rc.6] — 2026-05-16

### Changed
- CI release workflow auto-detects pre-release versions and publishes under the correct npm dist-tag (`next` for rc, `latest` for stable)

### Chores
- `docs/local/` gitignored to keep session notes and build logs out of the repo

---

## [0.1.0-rc.5] — 2026-05-15

### Added
- Invite creation is now blocked with a clear error when Anthropic or Composio API keys are missing — prevents silent failures during employee onboarding
- Brand fonts loaded at the root layout for consistent typography across all pages

### Fixed
- Real profile data now stored and served from disk; employee roster is fully disk-backed
- Employee card "done" state wired up correctly

---

## [0.1.0-rc.4] — 2026-05-14

### Added
- Copy-paste invitation links for CEO-driven employee onboarding — no terminal required for the employee side

---

## [0.1.0-rc.3] — 2026-05-13

### Added
- First-run CEO onboarding flow with founder introduction and onboarding video

### Changed
- Removed `EMPLOYEE001_DEMO` flag, baked-in personas, and all hard-coded demo data — fresh installs start from a clean slate

---

## [0.1.0-rc.2] — 2026-05-12

### Fixed
- Removed demo-id fallbacks that caused fresh installs (without `EMPLOYEE001_DEMO=true`) to behave unexpectedly

---

## [0.1.0-rc.1] — 2026-05-11

### Added
- Tag-driven GitHub Actions release workflow — push a `vX.Y.Z` tag to publish to npm automatically
- CI pipeline: lint + build on every push and pull request

### Infrastructure
- `CONTRIBUTING.md` — contribution guidelines, ground rules, and security contact

---

## [0.1.0] — 2026-05-10

### Added
- Initial public release
- Agent twins for every employee — always-on AI twins built from markdown profiles
- Twin council meetings — multi-twin debate and convergence on a single question
- Real tool execution via Composio MCP — Slack, Linear, email, code, and more
- Org Brain — shared knowledge graph every twin reads from
- On-prem by design — binds to `127.0.0.1`, all data stays in `./data/`
- Shared-secret token to gate LAN-exposed installs
- CLI commands: `setup`, `start`, `update`, `doctor`, `help`
- Human-controlled autonomy — approval gate before any sensitive tool call executes

[Unreleased]: https://github.com/dolevhayut/Employee001/compare/v0.1.0-rc.6...HEAD
[0.1.0-rc.6]: https://github.com/dolevhayut/Employee001/compare/v0.1.0-rc.5...v0.1.0-rc.6
[0.1.0-rc.5]: https://github.com/dolevhayut/Employee001/compare/v0.1.0-rc.4...v0.1.0-rc.5
[0.1.0-rc.4]: https://github.com/dolevhayut/Employee001/compare/v0.1.0-rc.3...v0.1.0-rc.4
[0.1.0-rc.3]: https://github.com/dolevhayut/Employee001/compare/v0.1.0-rc.2...v0.1.0-rc.3
[0.1.0-rc.2]: https://github.com/dolevhayut/Employee001/compare/v0.1.0-rc.1...v0.1.0-rc.2
[0.1.0-rc.1]: https://github.com/dolevhayut/Employee001/compare/v0.1.0...v0.1.0-rc.1
[0.1.0]: https://github.com/dolevhayut/Employee001/releases/tag/v0.1.0
