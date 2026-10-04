import { describe, expect, it } from "vitest";
import { verifyRcpEvidence } from "./evidence";
import type { RoleContextPackage } from "./rcp.types";

function rcpWithQuote(evidenceQuote: string): RoleContextPackage {
  return {
    source_twin_id: "employee-1",
    schema_version: "relay-rcp-1",
    generated_at: "2026-10-04T00:00:00.000Z",
    synth_mode: "fixture",
    status: "draft",
    decision_rules: [{
      id: "claim-1",
      title: "Release rule",
      body: "Use the release checklist.",
      provenance: "interview",
      confidence: 0.9,
      gaps: [],
      evidenceQuote,
    }],
    playbooks: [], contact_graph: [], edge_cases: [], tooling_map: [], glossary: [], open_loops: [],
    provenance: {
      interviewerModel: "fixture", transcriptRef: "test", redactionApplied: true,
      itemCount: 1,
      consent: { subjectId: "employee-1", grantedAt: "2026-10-04T00:00:00.000Z", banner: "DEMO" },
      auditRunId: "test",
    },
  };
}

describe("verifyRcpEvidence", () => {
  it("marks an exact quote as verified", () => {
    const result = verifyRcpEvidence(rcpWithQuote("Use the release checklist."), "Use the release checklist.");
    expect(result.decision_rules[0]).toMatchObject({ verified: true });
  });

  it("normalizes whitespace, quotation marks, and dashes before matching", () => {
    const result = verifyRcpEvidence(
      rcpWithQuote('“Review  the  deploy — then ship.”'),
      '"Review the deploy - then ship."',
    );
    expect(result.decision_rules[0].verified).toBe(true);
  });

  it("matches Hebrew evidence with or without niqqud", () => {
    const result = verifyRcpEvidence(rcpWithQuote("הַשְׁלִימוּ אֶת הַבְּדִיקָה"), "השלימו את הבדיקה");
    expect(result.decision_rules[0].verified).toBe(true);
  });

  it("flags a fabricated quote without dropping the claim", () => {
    const result = verifyRcpEvidence(rcpWithQuote("This never happened."), "Use the release checklist.");
    expect(result.decision_rules).toHaveLength(1);
    expect(result.decision_rules[0]).toMatchObject({ verified: false, verificationReason: expect.stringContaining("not found") });
  });

  it("flags every claim when the transcript is empty", () => {
    const result = verifyRcpEvidence(rcpWithQuote("Use the release checklist."), "");
    expect(result.decision_rules[0]).toMatchObject({ verified: false, verificationReason: "Source transcript is empty." });
  });
});
