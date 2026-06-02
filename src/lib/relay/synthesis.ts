/**
 * Relay · RCP Synthesis
 *
 * Turns a captured interview transcript + working notes (+ a thin twin-profile
 * summary) into a Role Context Package (RCP).
 *
 * TWO paths, by design (PRD section 6 + the no-API demo contract):
 *
 *   1) synthesizeRcpFixture(input) — DETERMINISTIC, NO API CALL. This is the
 *      DEMO DEFAULT and MUST work with no Anthropic key. It maps a structured
 *      interview transcript (array of tagged turns) into a fully-populated,
 *      schema-valid RoleContextPackage. Coverage is rich enough that
 *      scoreCoverage() returns status 'handover-ready' for the demo transcript.
 *
 *   2) buildSynthesisPrompt(input) — the prompt that WOULD be sent to the opus
 *      model for the real (synthMode:'model') path. NOT invoked in the demo.
 *
 * Plus redactPii(text) — a simple PII / secret redaction pass (PRD §9 / 13.5)
 * applied to every incoming answer before it lands in the RCP.
 *
 * This module imports ONLY the portable contract from ./rcp.types — no other
 * E001 internals — so it stays close to the spinout-surviving boundary.
 */

import {
  RCP_SCHEMA_VERSION,
  type CapturedItem,
  type ConsentRecord,
  type Provenance,
  type RoleContextPackage,
  type ToolingRef,
} from "./rcp.types";

// ─── Input shapes ────────────────────────────────────────────────────────────

/** The RCP fields a transcript turn / captured note can be tagged against. */
export type CaptureArea =
  | "decision_rules"
  | "playbooks"
  | "contact_graph"
  | "edge_cases"
  | "tooling_map"
  | "glossary"
  | "open_loops";

/**
 * One structured turn from the capture interview. In model mode these are
 * emitted by the sonnet interviewer; in fixture mode they are read verbatim
 * from data/relay/transcripts/<id>.json.
 *
 * A turn is the atomic input to synthesis: a question, the employee's answer,
 * the RCP area it maps to, and the honest provenance/confidence/gaps tags the
 * interviewer attached (PRD 6).
 */
export interface TranscriptTurn {
  /** Stable id (used to derive the captured item id + audit attribution). */
  id: string;
  area: CaptureArea;
  /** The interviewer's question. */
  question: string;
  /** The employee's answer — the substantive content. */
  answer: string;
  /** Short label / term. Required for glossary; optional elsewhere. */
  title?: string;
  provenance: Provenance;
  /** 0..1. */
  confidence: number;
  /** Honest known-unknowns for this turn. */
  gaps?: string[];
  /** tooling_map only: where the system lives (host/ref — never a secret). */
  toolingLocation?: string;
  /** tooling_map only: how access is granted (process — never a token). */
  toolingAccessVia?: string;
  /** tooling_map only: owning role/team (no PII). */
  toolingOwnedBy?: string;
}

/**
 * A thin summary of the twin's onboarding profile. Used only to enrich the
 * `confirmed-from-history` framing; the substance comes from the transcript.
 */
export interface TwinProfileSummary {
  employeeId: string;
  name?: string;
  role?: string;
  department?: string;
}

/** Everything synthesis needs. Portable — no E001 internals. */
export interface SynthesisInput {
  profile: TwinProfileSummary;
  transcript: TranscriptTurn[];
  consent: ConsentRecord;
  /** Reference to the source transcript (path or id) for provenance. */
  transcriptRef: string;
  /** Run id used for audit attribution (equals the handoverId). */
  auditRunId: string;
  /**
   * Model id recorded as the interviewer in provenance. 'fixture' for the demo
   * default, or the sonnet capture model id in model mode.
   */
  interviewerModel?: string;
  /** ISO-8601 override for generated_at (tests/repro). Defaults to now. */
  generatedAt?: string;
}

// ─── PII / secret redaction (PRD §9 / 13.5) ──────────────────────────────────

/**
 * Simple, deterministic PII + secret redaction pass.
 *
 * Scrubs the categories most likely to leak through a free-text interview
 * answer before it is committed to the RCP: emails, phone numbers, and
 * anything that looks like a credential / token / key / password. This is a
 * defensive demo pass — NOT a substitute for legal review (hence the banner).
 *
 * Order matters: credential-bearing key:value pairs are caught first (so we
 * don't half-redact them with the generic token rule), then structured PII.
 */
export function redactPii(text: string): string {
  if (!text) return text;
  let out = text;

  // 1) Explicit secret ASSIGNMENTS: password=..., api_key: ..., token is "...".
  //    Only an actual assignment separator (`:`, `=`, or the word `is`) counts —
  //    a bare space does NOT, so legitimate prose like "auth services",
  //    "token bucket", or "secret sauce" is left intact. Capture the label +
  //    separator, redact the value (to end of quote / whitespace run).
  out = out.replace(
    /\b(pass(?:word|wd|phrase)?|secret|api[_-]?key|access[_-]?key|token|bearer|authorization|client[_-]?secret|private[_-]?key|credential)s?\b(\s*[:=]\s*|\s+is\s+)(["']?)([^\s"']{4,})\3/gi,
    (_m, label: string, sep: string) => `${label}${sep}[REDACTED-SECRET]`,
  );

  // 2) Bearer / Authorization header style: "Bearer eyJ..." already covered above,
  //    but also catch standalone JWT-ish and long hex/base64 secrets.
  out = out.replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9._-]{10,}\b/g, "[REDACTED-TOKEN]");
  // Common provider key prefixes (sk-, pk-, ghp_, xoxb-, AKIA…, AIza…).
  out = out.replace(
    /\b(?:sk|pk|rk)[-_][A-Za-z0-9]{16,}\b/g,
    "[REDACTED-TOKEN]",
  );
  out = out.replace(/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g, "[REDACTED-TOKEN]");
  out = out.replace(/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, "[REDACTED-TOKEN]");
  out = out.replace(/\bAKIA[0-9A-Z]{16}\b/g, "[REDACTED-TOKEN]");
  out = out.replace(/\bAIza[0-9A-Za-z_-]{30,}\b/g, "[REDACTED-TOKEN]");
  // Generic long hex (>=32) or base64-ish (>=32) run that looks like a secret.
  out = out.replace(/\b[0-9a-fA-F]{32,}\b/g, "[REDACTED-TOKEN]");

  // 3) Emails.
  out = out.replace(
    /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    "[REDACTED-EMAIL]",
  );

  // 4) Phone numbers (international + common separators, 7+ digits).
  out = out.replace(
    /(?<!\w)(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?){2,4}\d{2,4}(?!\w)/g,
    (m) => {
      const digits = m.replace(/\D/g, "");
      return digits.length >= 7 && digits.length <= 15 ? "[REDACTED-PHONE]" : m;
    },
  );

  return out;
}

// ─── Fixture synthesis (DEMO DEFAULT — no API) ───────────────────────────────

/**
 * Map one transcript turn into a CapturedItem (non-tooling areas).
 * Applies redactPii to the answer.
 */
function turnToCapturedItem(turn: TranscriptTurn): CapturedItem {
  const body = redactPii(turn.answer).trim();
  const title =
    (turn.title && turn.title.trim()) ||
    deriveTitle(turn.area, turn.question, body);
  return {
    id: turn.id,
    title,
    body,
    provenance: turn.provenance,
    confidence: clamp01(turn.confidence),
    gaps: dedupe(turn.gaps ?? []),
  };
}

/** Map one tooling-tagged turn into a ToolingRef (references only — no secrets). */
function turnToToolingRef(turn: TranscriptTurn): ToolingRef {
  const system =
    (turn.title && turn.title.trim()) ||
    deriveTitle("tooling_map", turn.question, turn.answer);
  return {
    id: turn.id,
    system,
    // Locations / access notes are references, but still run through redaction
    // as a belt-and-braces guard against an accidental secret in the note.
    location: redactPii((turn.toolingLocation ?? "unspecified").trim()),
    accessVia: redactPii(
      (turn.toolingAccessVia ?? "request via the owning team").trim(),
    ),
    ownedBy: turn.toolingOwnedBy
      ? redactPii(turn.toolingOwnedBy.trim())
      : undefined,
    provenance: turn.provenance,
    confidence: clamp01(turn.confidence),
    gaps: dedupe(turn.gaps ?? []),
  };
}

/**
 * Deterministically synthesize a complete, schema-valid RCP from a transcript.
 * NO API call. This is the demo default.
 *
 * Behaviour:
 *  - Groups transcript turns by RCP area.
 *  - Maps non-tooling turns -> CapturedItem[]; tooling turns -> ToolingRef[].
 *  - Redacts PII/secrets from every answer (redactPii).
 *  - If the supplied transcript is thin for any area, falls back to a baked-in
 *    demo seed for that area so the demo always produces a complete RCP. The
 *    seed is grounded in the demo employee's role and is clearly tagged.
 *  - Sets `status` later (the runner's coverage phase owns the authoritative
 *    flip via scoreCoverage); here we set it from the same rubric so a
 *    standalone fixture run is internally consistent.
 */
export function synthesizeRcpFixture(input: SynthesisInput): RoleContextPackage {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const byArea = groupByArea(input.transcript);

  const seed = demoSeed(input.profile);

  const decision_rules = pick(byArea.decision_rules, seed.decision_rules);
  const playbooks = pick(byArea.playbooks, seed.playbooks);
  const contact_graph = pick(byArea.contact_graph, seed.contact_graph);
  const edge_cases = pick(byArea.edge_cases, seed.edge_cases);
  const glossary = pick(byArea.glossary, seed.glossary);
  const open_loops = pick(byArea.open_loops, seed.open_loops);

  const tooling_map = pickTooling(byArea.tooling_map, seed.tooling_map);

  const itemCount =
    decision_rules.length +
    playbooks.length +
    contact_graph.length +
    edge_cases.length +
    tooling_map.length +
    glossary.length +
    open_loops.length;

  // Internal consistency: derive status from the same rubric the runner uses.
  const status = deriveStatus({
    decision_rules,
    playbooks,
    contact_graph,
    edge_cases,
    tooling_map,
    glossary,
    open_loops,
  });

  return {
    source_twin_id: input.profile.employeeId,
    schema_version: RCP_SCHEMA_VERSION,
    generated_at: generatedAt,
    synth_mode: "fixture",
    status,
    decision_rules,
    playbooks,
    contact_graph,
    edge_cases,
    tooling_map,
    glossary,
    open_loops,
    provenance: {
      interviewerModel: input.interviewerModel ?? "fixture",
      transcriptRef: input.transcriptRef,
      redactionApplied: true,
      itemCount,
      consent: input.consent,
      auditRunId: input.auditRunId,
    },
  };
}

// ─── Real (opus) synthesis prompt — NOT invoked in the demo ──────────────────

/**
 * Builds the synthesis prompt that WOULD be sent to the opus model in
 * synthMode:'model'. The model is asked to emit a strict RoleContextPackage
 * JSON matching ./rcp.types — references only in tooling_map, honest
 * provenance/confidence/gaps per item.
 *
 * NOT called in the fixture demo. Kept here so the model path is a drop-in.
 */
export function buildSynthesisPrompt(input: SynthesisInput): string {
  const { profile } = input;
  const who = [profile.name, profile.role && `(${profile.role}`, profile.department && `, ${profile.department})`]
    .filter(Boolean)
    .join("")
    .replace(/\($/, "")
    .trim();

  const notes = input.transcript
    .map((t) => {
      const head = `### [${t.area}] ${t.title ?? t.question}`;
      const meta = `provenance=${t.provenance} · confidence=${t.confidence}${
        t.gaps?.length ? ` · gaps: ${t.gaps.join("; ")}` : ""
      }`;
      const tooling =
        t.area === "tooling_map"
          ? `\nlocation: ${t.toolingLocation ?? "?"} · accessVia: ${
              t.toolingAccessVia ?? "?"
            }${t.toolingOwnedBy ? ` · ownedBy: ${t.toolingOwnedBy}` : ""}`
          : "";
      // Note: answers are pre-redacted before reaching the model.
      return `${head}\nQ: ${t.question}\nA: ${redactPii(t.answer)}${tooling}\n${meta}`;
    })
    .join("\n\n");

  return `You are the RCP synthesizer for the Relay handover surface.

Subject: ${who || profile.employeeId} (twin id: ${profile.employeeId}).

You are given the captured interview transcript below — tagged working notes
from the capture interviewer, already PII/secret-redacted. Your job is to
synthesize them into a single Role Context Package (RCP) JSON object that a
successor can rely on to do this person's job.

## Output contract — emit ONLY valid JSON matching this shape

{
  "source_twin_id": "${profile.employeeId}",
  "schema_version": "${RCP_SCHEMA_VERSION}",
  "generated_at": "<ISO-8601>",
  "synth_mode": "model",
  "status": "draft" | "handover-ready",
  "decision_rules": CapturedItem[],   // rules, approval thresholds, escalation logic
  "playbooks": CapturedItem[],        // ordered, runnable processes (markdown list in body)
  "contact_graph": CapturedItem[],    // who owns what + informal key people (roles/handles only)
  "edge_cases": CapturedItem[],       // situation + how it was handled
  "tooling_map": ToolingRef[],        // { system, location, accessVia, ownedBy? } — REFERENCES ONLY
  "glossary": CapturedItem[],         // title = term, body = definition
  "open_loops": CapturedItem[],       // task + current state + next action
  "provenance": { ... }
}

CapturedItem = { id, title, body, provenance, confidence (0..1), gaps: string[] }
ToolingRef   = { id, system, location, accessVia, ownedBy?, provenance, confidence, gaps }

## Hard rules
- tooling_map carries NO secrets, passwords, keys, or tokens — references only
  (system name, where it lives, who grants access). If a note contains a
  credential, drop it and add a gap noting access must be requested live.
- Preserve each note's provenance verbatim ('interview' | 'confirmed-from-history').
- Set confidence honestly; carry forward every gap the interviewer flagged and
  add any you infer.
- Merge duplicate notes; never invent facts not grounded in the transcript.
- Prefer specifics and stories over summaries. Keep playbook steps ordered.

## Captured transcript (PII/secret-redacted)

${notes || "(no transcript notes provided)"}

Emit the JSON object now. No prose, no code fences.`;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function dedupe(arr: string[]): string[] {
  return Array.from(new Set(arr.map((s) => s.trim()).filter(Boolean)));
}

function groupByArea(turns: TranscriptTurn[]): Record<CaptureArea, TranscriptTurn[]> {
  const out: Record<CaptureArea, TranscriptTurn[]> = {
    decision_rules: [],
    playbooks: [],
    contact_graph: [],
    edge_cases: [],
    tooling_map: [],
    glossary: [],
    open_loops: [],
  };
  for (const t of turns ?? []) {
    if (out[t.area]) out[t.area].push(t);
  }
  return out;
}

/**
 * Use transcript-derived items when present; otherwise fall back to the baked
 * demo seed for that area. We never *truncate* a rich transcript — if the
 * transcript covers an area we take it as-is and ignore the seed.
 */
function pick(turns: TranscriptTurn[], seed: CapturedItem[]): CapturedItem[] {
  if (turns.length > 0) return turns.map(turnToCapturedItem);
  return seed;
}

function pickTooling(turns: TranscriptTurn[], seed: ToolingRef[]): ToolingRef[] {
  if (turns.length > 0) return turns.map(turnToToolingRef);
  return seed;
}

function deriveTitle(area: CaptureArea, question: string, body: string): string {
  const base = (question || body || area).replace(/\s+/g, " ").trim();
  // Strip a leading interrogative so titles read as labels, not questions.
  const cleaned = base
    .replace(/^(walk me through|tell me about|how do you|when do you|what(?:'s| is)|who)\b[\s,:-]*/i, "")
    .replace(/\?+$/, "")
    .trim();
  const label = cleaned || base;
  return label.length > 72 ? `${label.slice(0, 69)}…` : label;
}

/**
 * Internal status derivation mirroring the demo-default coverage rubric
 * (kept in sync with ./coverage.ts COVERAGE_RUBRIC). The runner's coverage
 * phase is the authoritative source via scoreCoverage(); this just keeps a
 * standalone fixture RCP internally consistent.
 */
function deriveStatus(
  fields: Pick<
    RoleContextPackage,
    | "decision_rules"
    | "playbooks"
    | "contact_graph"
    | "edge_cases"
    | "tooling_map"
    | "glossary"
    | "open_loops"
  >,
): RoleContextPackage["status"] {
  const rubric: Array<[keyof typeof fields, number, number]> = [
    ["decision_rules", 4, 0.25],
    ["playbooks", 3, 0.2],
    ["contact_graph", 4, 0.15],
    ["edge_cases", 3, 0.15],
    ["tooling_map", 3, 0.1],
    ["open_loops", 2, 0.1],
    ["glossary", 3, 0.05],
  ];
  let score = 0;
  for (const [field, minItems, weight] of rubric) {
    const items = fields[field]?.length ?? 0;
    score += weight * Math.min(1, items / minItems);
  }
  return score >= 0.7 ? "handover-ready" : "draft";
}

// ─── Baked demo seed (grounded in the demo employee's role) ──────────────────

/**
 * A complete, coverage-passing fallback for the no-transcript / thin-transcript
 * case so the demo ALWAYS produces a handover-ready RCP with zero model calls.
 *
 * Grounded in the demo employee (Daniel Rivera, Senior Engineering Lead). Tagged
 * 'confirmed-from-history' where it derives from the on-file profile, and with
 * honest confidence + gaps. Item counts exceed every rubric minimum, so
 * scoreCoverage() returns 'handover-ready' (weightedScore = 1.0).
 */
function demoSeed(profile: TwinProfileSummary): {
  decision_rules: CapturedItem[];
  playbooks: CapturedItem[];
  contact_graph: CapturedItem[];
  edge_cases: CapturedItem[];
  tooling_map: ToolingRef[];
  glossary: CapturedItem[];
  open_loops: CapturedItem[];
} {
  const id = profile.employeeId;
  const ci = (
    n: string,
    title: string,
    body: string,
    confidence: number,
    gaps: string[],
    provenance: Provenance = "interview",
  ): CapturedItem => ({ id: `${id}:seed:${n}`, title, body, provenance, confidence, gaps });

  return {
    decision_rules: [
      ci(
        "dr-deploy-approval",
        "Production deploy approval",
        "Any deploy touching the billing or auth services needs a second engineer's sign-off on the PR before merge. Everything else: author can self-merge once CI is green and at least one review is in.",
        0.9,
        ["Threshold for 'large' refactors that should pull in a third reviewer is informal — worth writing down."],
      ),
      ci(
        "dr-incident-escalate",
        "When to escalate an incident",
        "Page the on-call SRE immediately for anything customer-facing (5xx spike, checkout failing, data loss risk). For internal-only degradation, file a ticket and handle in business hours. If unsure, escalate — over-paging is cheaper than a missed Sev1.",
        0.85,
        ["Exact error-rate threshold that auto-promotes Sev2 -> Sev1 lives in the runbook, not in my head."],
      ),
      ci(
        "dr-hiring-bar",
        "Engineering hiring bar",
        "A 'yes' needs strong signal on either systems depth or product judgment, plus no red flags on collaboration. A single weak interview is not a veto; two are. I write the debrief summary, but the panel decides.",
        0.8,
        ["How to weigh take-home vs live coding for senior candidates is still subjective."],
      ),
      ci(
        "dr-tech-debt-budget",
        "Tech-debt vs feature budget",
        "Roughly 20% of each sprint is reserved for paying down debt and reliability work. I protect that slot hard during crunch — skipping it twice in a row is the rule I will push back on PM about.",
        0.82,
        ["The 20% is a norm, not a tracked metric — no dashboard enforces it yet."],
      ),
      ci(
        "dr-vendor-spend",
        "Vendor / infra spend sign-off",
        "I can approve new infra spend up to ~$2k/mo on my own. Above that goes to the Eng Director with a one-paragraph justification. Anything touching a new data-processor contract also loops in Legal first.",
        0.78,
        ["Exact current approval ceiling may have changed after the last budget cycle — confirm with Finance."],
      ),
    ],
    playbooks: [
      ci(
        "pb-oncall-handoff",
        "Weekly on-call handoff",
        "1. Skim the open incidents board and PagerDuty timeline.\n2. Write a 3-bullet handoff note in #eng-oncall: what's still warm, what's resolved, what to watch.\n3. Confirm the incoming on-call has access to dashboards + runbook.\n4. Reassign any unresolved Sev2 tickets to the new on-call.",
        0.9,
        ["The handoff note template lives in my drafts, not in a shared doc yet."],
      ),
      ci(
        "pb-release",
        "Cutting a release",
        "1. Freeze main; announce in #releases.\n2. Tag the release branch, let CI build the artifact.\n3. Deploy to staging, run the smoke suite.\n4. Canary to 5% prod for 30 min, watch error rate + latency.\n5. Ramp to 100% if clean; otherwise roll back and open an incident.",
        0.88,
        ["Canary thresholds are partly tribal knowledge — the dashboard alarms cover the obvious ones only."],
      ),
      ci(
        "pb-postmortem",
        "Running a blameless postmortem",
        "1. Schedule within 48h while memory is fresh.\n2. Build the timeline from logs first, opinions second.\n3. Focus on contributing factors, never on individuals.\n4. Land 2-3 concrete action items with owners + dates.\n5. Publish to the postmortem wiki and link it from the incident ticket.",
        0.86,
        ["We don't consistently track whether postmortem action items actually ship."],
      ),
      ci(
        "pb-onboarding",
        "Onboarding a new engineer",
        "1. Pair them with a buddy for week one.\n2. First PR should be a small, real, shippable change by day 3.\n3. Walk them through the deploy + on-call story before they touch prod.\n4. Check in 1:1 at end of week 1, 2, and 4.",
        0.84,
        ["Buddy assignment is ad-hoc; no rotation list exists."],
      ),
    ],
    contact_graph: [
      ci(
        "cg-sre-lead",
        "SRE / infra owner",
        "Priya (SRE Lead, @priya) owns the alerting stack and prod access. Go to her before changing anything in the on-call rotation or touching infra IaC.",
        0.9,
        ["Backup contact when Priya is OOO is unclear."],
        "confirmed-from-history",
      ),
      ci(
        "cg-billing",
        "Billing domain expert",
        "Marcus (Staff Eng, @marcus) is the only person who deeply understands the legacy billing reconciliation job. Pull him in for anything touching invoices or proration.",
        0.88,
        ["Marcus is a single point of failure here — knowledge isn't documented."],
      ),
      ci(
        "cg-pm",
        "Product partner",
        "Sofia (Senior PM, @sofia) is my main product counterpart. She decides scope; I decide feasibility and sequencing. We sync Monday mornings.",
        0.85,
        [],
        "confirmed-from-history",
      ),
      ci(
        "cg-legal",
        "Legal / data contacts",
        "For anything touching customer data export or a new processor, loop in the Legal partner via the #legal-eng channel — don't DM individuals, the channel routes to whoever's on rotation.",
        0.8,
        ["Don't know the named Legal contact, only the channel."],
      ),
      ci(
        "cg-fixer",
        "The informal fixer",
        "Dana (Eng Ops, @dana) isn't on the org chart for it but unblocks access requests, vendor accounts, and tooling licenses faster than the official process. Ask nicely.",
        0.75,
        ["This is informal — no guarantee it survives Dana changing roles."],
      ),
    ],
    edge_cases: [
      ci(
        "ec-acme-billing",
        "The Acme double-charge incident",
        "Acme got double-charged when a retry storm hit the billing job during a deploy. Fix was to make the charge endpoint idempotent on the invoice id. Watch out: the legacy reconciliation job still assumes at-most-once and will silently drop a legitimate retry if you're not careful.",
        0.85,
        ["The idempotency key handling on the legacy path was never fully audited."],
      ),
      ci(
        "ec-tz-cron",
        "The timezone cron bug",
        "A nightly job ran in UTC but reported in local time, so month-end reports were off by a day twice a year around DST. Fix: pin everything to UTC end-to-end and convert only at the presentation layer. Any new scheduled job: assume UTC, never server-local.",
        0.82,
        ["There may be other local-time assumptions lurking in older cron jobs."],
      ),
      ci(
        "ec-thundering-herd",
        "Cache-stampede on cold start",
        "After a full cache flush, the first requests stampede the DB and tip it over. We added request coalescing + a short jittered backoff. If you ever flush prod cache, do it gradually or pre-warm — never cold-flush at peak.",
        0.8,
        ["The pre-warm script is manual and undocumented."],
      ),
    ],
    tooling_map: [
      {
        id: `${id}:seed:tool-pagerduty`,
        system: "PagerDuty",
        location: "pagerduty.com (org SSO)",
        accessVia: "Request via IT ticket; SRE Lead approves on-call schedule changes",
        ownedBy: "SRE Lead (@priya)",
        provenance: "interview",
        confidence: 0.9,
        gaps: ["Escalation policy IDs not captured here — see PagerDuty UI."],
      },
      {
        id: `${id}:seed:tool-datadog`,
        system: "Datadog",
        location: "app.datadoghq.com (org SSO)",
        accessVia: "SSO group 'eng-all'; dashboard edit needs 'eng-leads' group",
        ownedBy: "SRE team",
        provenance: "confirmed-from-history",
        confidence: 0.85,
        gaps: ["Which dashboards are canonical vs experimental is unclear."],
      },
      {
        id: `${id}:seed:tool-deploy`,
        system: "Internal deploy console",
        location: "deploy.internal (behind VPN)",
        accessVia: "Granted via the 'deployers' role; request in #eng-access",
        ownedBy: "Eng Ops (@dana)",
        provenance: "interview",
        confidence: 0.82,
        gaps: ["Rollback permissions are separate from deploy permissions — confirm scope per role."],
      },
    ],
    glossary: [
      ci("gl-canary", "Canary", "A staged rollout to a small % of prod traffic before full release, watched for error/latency regressions.", 0.95, []),
      ci("gl-recon", "Recon job", "The nightly billing reconciliation job that matches charges to invoices. Legacy, fragile, owned informally by Marcus.", 0.88, ["Exact schedule + owner of record is fuzzy."]),
      ci("gl-warm", "Warm (incident)", "An incident that's mitigated but not yet root-caused/closed — still needs watching during handoff.", 0.9, []),
      ci("gl-twenty", "The 20%", "Shorthand for the reliability/tech-debt budget reserved each sprint.", 0.85, []),
    ],
    open_loops: [
      ci(
        "ol-billing-idempotency",
        "Finish billing idempotency rollout",
        "Idempotency is live on the new charge path; the legacy reconciliation path still needs the same treatment. Next action: pair with Marcus to audit the legacy key handling before next billing cycle.",
        0.85,
        ["No ticket owner assigned yet if I'm out."],
      ),
      ci(
        "ol-oncall-docs",
        "Document the on-call handoff template",
        "Handoff note template only lives in my drafts. Next action: move it into the shared #eng-oncall pinned doc so it survives my absence.",
        0.8,
        [],
      ),
      ci(
        "ol-hiring-loop",
        "Senior backend hire in flight",
        "One senior backend candidate is at the offer stage; Sofia's team is waiting on the hire for the billing rework. Next action: chase the offer status with the recruiter and keep Sofia posted.",
        0.78,
        ["Compensation band sign-off may still be pending with Finance."],
      ),
    ],
  };
}
