---
question: "Should Lumen Labs move the Lumen Insights Q4 launch from November 12 to December 3 to finish SSO?"
participants:
  - amara-vale
  - marcus-reed
  - priya-nair
  - elise-moreno
  - yael-ben-ami
---

## amara-vale
I want a recommendation, not a status report. The November 12 date was chosen so our early-access customers could use Insights in their December board packs. But the SSO work is not a cosmetic checkbox: Marcus says the SCIM edge cases are still open, and Priya has not signed the tenant-isolation review. If we hold November 12, what exactly are we asking customers and support to absorb? Please weigh the launch promise against the risk of teaching the market that our enterprise product has a workaround on day one.

## marcus-reed
I recommend moving the public launch to December 3. The core Insights pipeline is stable, and we could technically ship November 12 with password login, but that creates two code paths for provisioning and support. The risky part is not the SAML happy path; it is deprovisioning and JIT role mapping when an analyst changes teams. We found two stale-session cases in the September 29 Orbit migration rehearsal. I can finish them by November 21, then give Priya a clean week for adversarial testing. A short private preview for the three design partners is feasible, but I would not call that general availability.

## priya-nair
I agree with Marcus on the public date, and I want to be precise about why. The current fallback lets an administrator invite a user after SSO is enabled. That sounds harmless until an employee leaves and the identity provider disables them while their local session remains valid. For a product that summarizes revenue and retention data, that is the wrong first enterprise story. December 3 gives us time to test deprovisioning, audit logs, and the shared-tenant boundary together. I do not need a perfect security program; I need one release candidate that behaves consistently under failure. I would approve a tightly scoped preview only with named admins and weekly access review.

## elise-moreno
I disagree with moving every customer-facing moment. We promised the November 12 cohort a usable workflow, and silence until December will cost trust with Northstar Atlas, Greenbridge Systems, and HarborMetric. I support changing the label from launch to private preview, but only if we call each sponsor this week with a dated path: preview on November 12, migration support by November 21, and general availability December 3. Their success teams need a concrete reporting plan for December board packs. I will own the calls and the revised enablement brief, but I need Amara to make the distinction public internally so sales does not sell GA before Priya signs it.

## yael-ben-ami
I support the split, with one condition: the preview must feel intentional, not like a delayed product hidden behind a feature flag. In the August research sessions, admins said their real anxiety was explaining access changes to finance leaders. A small preview lets us test the setup language, the audit-log empty state, and the invitation copy with people who know the context. אני מעדיפה שנציג את זה כשלב למידה מוגבל, לא כ"השקה חלקית". My recommendation is clear: announce December 3 as the GA date today, invite only the three partners on November 12, and publish a weekly readiness note owned by Marcus and Priya. Amara, please make the call so everyone works from one promise.
