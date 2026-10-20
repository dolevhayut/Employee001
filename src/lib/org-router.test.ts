import { describe, expect, it } from "vitest";
import { routeQuestion, type RouteCandidate } from "./org-router";

const TWINS: RouteCandidate[] = [
  { id: "itai", firstName: "Itai", name: "Itai Cohen", role: "Senior Backend Engineer", text: "Postgres, incident response, Beacon migration, APIs." },
  { id: "noa", firstName: "Noa", name: "Noa Friedman", role: "CTO & Co-Founder", text: "Architecture, hiring engineers, roadmap, technical strategy." },
  { id: "shira", firstName: "Shira", name: "Shira Levi", role: "Product Manager", text: "Roadmap, customer interviews, pricing pages, onboarding." },
  { id: "daniel", firstName: "Daniel", name: "Daniel Azoulay", role: "Head of Customer Success", text: "Customer renewals, churn, support tickets, Northstar account." },
];

describe("routeQuestion", () => {
  it("routes to the twin whose role and profile match", () => {
    expect(routeQuestion("Which customer renewals are at risk of churn?", TWINS)[0].id).toBe("daniel");
    expect(routeQuestion("How is the Postgres incident going?", TWINS)[0].id).toBe("itai");
  });

  it("can ask several twins for a cross-team question", () => {
    const ids = routeQuestion("What's on the roadmap and how does it affect customer renewals?", TWINS).map((p) => p.id);
    expect(ids.length).toBeGreaterThan(1);
    expect(ids).toContain("daniel");
  });

  it("always includes a twin named in the question", () => {
    const ids = routeQuestion("Ask Shira what she thinks about Postgres", TWINS).map((p) => p.id);
    expect(ids).toContain("shira");
  });

  it("falls back to one twin when nothing matches", () => {
    expect(routeQuestion("good morning", TWINS)).toHaveLength(1);
  });

  it("explains the pick with the matched words", () => {
    expect(routeQuestion("churn on the Northstar account", TWINS)[0].matched).toEqual(expect.arrayContaining(["northstar"]));
  });
});
