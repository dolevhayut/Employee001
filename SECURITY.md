# Security Policy

## Supported Versions

| Version | Supported |
|---|---|
| 0.1.x (latest rc) | ✅ |
| < 0.1.0 | ❌ |

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Email **office@bulldog-adv.com** with:
- A description of the vulnerability
- Steps to reproduce or a proof-of-concept
- The potential impact as you see it

We will acknowledge receipt within **2 business days** and aim to ship a fix or mitigation within **14 days** for critical issues. We'll keep you updated as we work through it.

## Scope

Employee001 runs entirely on your local machine and binds to `127.0.0.1` by default. The primary attack surfaces are:

- **The shared-secret token** — used to gate LAN-exposed installs (`EMPLOYEE001_TOKEN` in `.env`). Weak or leaked tokens let anyone on the same network impersonate the CEO.
- **The Anthropic and Composio API keys** stored in `.env` — exposure gives an attacker access to your LLM quota and connected tools.
- **The `data/` directory** — contains employee profiles, audit logs, and org knowledge in plaintext. Protect it with filesystem permissions (`chmod 700 data/`).
- **Prompt injection** via employee profiles or org-brain documents — a malicious document could attempt to steer twin behavior.

## Out of Scope

- Issues that require physical access to the machine running Employee001
- Social engineering
- Vulnerabilities in Anthropic's or Composio's infrastructure (report those to them directly)

## Disclosure Policy

Once a fix is released, we will publish a brief advisory in `CHANGELOG.md` describing the vulnerability, its impact, and the fix — without disclosing details that would help attackers exploit unpatched installs before they upgrade.

We follow [responsible disclosure](https://cheatsheetseries.owasp.org/cheatsheets/Vulnerability_Disclosure_Cheat_Sheet.html) and will credit reporters who want to be named.
