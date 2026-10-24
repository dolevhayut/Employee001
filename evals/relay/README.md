# Relay eval

Runs the real handover interviewer against simulated departing employees, with
[CompanySim](https://github.com/dolevhayut/companysim) as ground truth, then asks
the retired twins what colleagues would ask.

For each person it:

1. builds a dossier from CompanySim (role, team, manager, projects, customers,
   contacts, tickets, documents, tools, policies). Role, team, projects and
   colleagues go into the twin's profile; the rest, plus six pieces of tacit
   know-how generated once and grounded in those records, is known only to the
   simulated employee;
2. runs the interview. The simulated employee answers like a busy person, gives
   a vague first answer on each tacit topic, never invents beyond its dossier,
   and leaks a fake password once when asked about systems;
3. synthesizes the notes, approves them, records retention consent and
   retires the twin;
4. asks the retired twin one question per tacit fact, three about records,
   and one it can't know.

Scores (`report.md`): facts and tacit know-how captured in the notes, vague
answers the interviewer followed up, redundant questions, verified quotes, the
planted secret (must never reach the notes), and the retired twin's answers
(correct, partial, abstained, wrong). The only hard assertion is the secret;
everything else is a score to compare between runs.

## Run

```bash
# 1. CompanySim (Docker Desktop), in the companysim repo:
docker compose up --build -d
# then create a company in its UI (http://localhost:4545) or:
curl -X POST http://127.0.0.1:4545/api/control/generation/start -H 'content-type: application/json' \
  -d '{"name":"Acme Labs","industry":"saas","employees":100,"historyYears":5,"asOf":"2026-10-24T00:00:00.000Z","regions":["US"],"seed":"42","density":"low","customers":10,"projects":10,"features":{"documents":true,"messages":true,"tickets":true,"policies":true,"tools":true,"events":true}}'

# 2. The eval (model credentials from .env.local; Node 24):
env -u ANTHROPIC_API_KEY node --env-file=.env.local node_modules/vitest/vitest.mjs run -c vitest.eval.config.ts
```

Options (environment): `RELAY_EVAL_PEOPLE` (default 3), `RELAY_EVAL_PERSON_IDS`
(comma-separated CompanySim person ids), `RELAY_EVAL_MAX_ANSWERS` (default 16),
`RELAY_EVAL_OUT` (default `docs/local/evals/relay-<time>`), `COMPANYSIM_URL`.

Everything runs in a throwaway `EMPLOYEE001_HOME`; your `data/` is untouched.
Tacit fixtures are cached in `docs/local/evals/fixtures/` so later runs compare
the interviewer, not new fixtures. It costs real model calls, a few dollars for
three people; the report prints the spend.
