// Example briefs for the "Build my twin" gallery. Illustrative only: invented
// roles and no real names, companies, customers, credentials or addresses.
// Starting from one fills the role and the notes box; the person edits the
// text and builds a normal twin from it.

export type StarterPack = {
  id: string;
  title: string;
  /** Role pre-filled into the role field. */
  role: string;
  summary: string;
  /** Pre-filled into the "About your work" box. */
  notes: string;
};

export const STARTER_PACKS: StarterPack[] = [
  {
    id: "starter-customer-success",
    title: "Customer success lead",
    role: "Head of Customer Success",
    summary: "Owns renewals, onboarding and escalations for a mid-size customer base.",
    notes: `## What I own
- Onboarding for new accounts, renewals, and escalations that support can't close.
- A good week: every at-risk account has a named next step and no escalation is older than two days.

## Decisions I make often
- Whether to offer a goodwill credit (small ones myself; anything larger goes to finance).
- When to pull in engineering: only with a reproducible case and the account impact.

## Questions people ask me most
- "Why is this account flagged at risk?" Usual answer: usage dropped, the sponsor left, or an open bug.
- "Can we extend the trial?" Usual answer: once, by 14 days, with a written goal.

## How I write
Short, warm, specific. I name the next step and the date. No jargon.

## What a twin shouldn't decide without me
Refunds, contract changes, and anything promised to a customer in writing.
`,
  },
  {
    id: "starter-product-manager",
    title: "Product manager",
    role: "Product Manager",
    summary: "Turns customer problems into scoped work and keeps priorities honest.",
    notes: `## What I own
- The roadmap for one product area, the backlog, and the written spec for each item.
- A good week: next sprint is scoped, every open question has an owner, and stakeholders know what slipped.

## Decisions I make often
- What goes in or out of a release when time is short. I cut scope before I move dates.
- Whether a request is a bug, a gap, or a new bet.

## Questions people ask me most
- "Is this on the roadmap?" Usual answer: where it sits, why, and what would move it.
- "What does done mean here?" Usual answer: the acceptance criteria in the spec.

## How I write
Plain sentences, problem first, then the proposal, then the trade-offs.

## What a twin shouldn't decide without me
Priority changes, commitments to dates, and anything that changes pricing.
`,
  },
  {
    id: "starter-operations-manager",
    title: "Operations manager",
    role: "Operations Manager",
    summary: "Keeps recurring processes, vendors and approvals running smoothly.",
    notes: `## What I own
- Recurring processes: onboarding checklists, vendor reviews, monthly reporting.
- A good week: nothing is waiting on an approval I could have chased, and every process has a current owner.

## Decisions I make often
- Which requests need a formal approval and which can go ahead with a heads-up.
- When a process is broken enough to rewrite instead of patch.

## Questions people ask me most
- "Who approves this?" Usual answer: the budget owner, then me for the process check.
- "Where is the latest version?" Usual answer: the shared process folder, with the date in the file name.

## How I write
Checklists and numbered steps. Dates and owners on every action.

## What a twin shouldn't decide without me
Vendor contracts, spending above the team limit, and changes to access rights.
`,
  },
];

/** The pack last put into the form, remembered so a later pick can tell an
 *  untouched example from text the person wrote or edited. */
export type AppliedPack = { id: string; role: string; notes: string };

export type PackPlan =
  | { action: "set"; written: string; role: string; applied: AppliedPack }
  | { action: "confirm"; written: string; role: string; applied: AppliedPack }
  | { action: "noop" };

/** What starting from `pack` should do to the form.
 *  - empty form, or the previous example untouched: replace it.
 *  - the same pack again over edited text: nothing (keeps the edits).
 *  - a different pack over an edited example: ask first, then replace.
 *  - the person's own text: keep it and add the example below. */
export function planStarterPack(
  state: { written: string; role: string; applied: AppliedPack | null },
  pack: StarterPack,
): PackPlan {
  const { written, role, applied } = state;
  const next: AppliedPack = { id: pack.id, role: pack.role, notes: pack.notes };
  // The role follows the pack unless the person typed their own.
  const nextRole = !role.trim() || (applied && role.trim() === applied.role) ? pack.role : role;
  const text = written.trim();
  if (!text) return { action: "set", written: pack.notes, role: nextRole, applied: next };
  if (applied && text === applied.notes.trim()) {
    return { action: "set", written: pack.notes, role: nextRole, applied: next };
  }
  if (applied) {
    if (applied.id === pack.id) return { action: "noop" };
    return { action: "confirm", written: pack.notes, role: nextRole, applied: next };
  }
  return { action: "set", written: `${text}\n\n${pack.notes}`, role: nextRole, applied: next };
}

/** True while the notes are still exactly the example, nothing of the person's own. */
export function isUnchangedExample(written: string, applied: AppliedPack | null): boolean {
  return !!applied && written.trim() === applied.notes.trim();
}
