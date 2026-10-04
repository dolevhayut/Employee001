import type { CapturedItem, RoleContextPackage, ToolingRef } from "./rcp.types";

type RcpItem = CapturedItem | ToolingRef;

const RCP_ITEM_FIELDS = [
  "decision_rules",
  "playbooks",
  "contact_graph",
  "edge_cases",
  "tooling_map",
  "glossary",
  "open_loops",
] as const;

/** Normalize only presentation differences before checking a quote verbatim. */
export function normalizeEvidenceText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0591-\u05C7]/g, "") // Hebrew niqqud and cantillation marks
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F\u05F4]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Return an RCP copy with every captured item marked by a local, pure evidence
 * check. Claims are never removed: missing or fabricated quotes stay visible
 * and are explicitly marked unverified.
 */
export function verifyRcpEvidence(
  rcp: RoleContextPackage,
  transcript: string,
): RoleContextPackage {
  const normalizedTranscript = normalizeEvidenceText(transcript);

  const verifyItem = <T extends RcpItem>(item: T): T => {
    const quote = typeof item.evidenceQuote === "string" ? normalizeEvidenceText(item.evidenceQuote) : "";
    const result = !normalizedTranscript
      ? { verified: false, verificationReason: "Source transcript is empty." }
      : !quote
        ? { verified: false, verificationReason: "Missing evidence quote." }
        : normalizedTranscript.includes(quote)
          ? { verified: true, verificationReason: "Evidence quote appears verbatim in the source transcript." }
          : { verified: false, verificationReason: "Evidence quote was not found verbatim in the source transcript." };
    return { ...item, ...result };
  };

  const verifiedFields = Object.fromEntries(
    RCP_ITEM_FIELDS.map((field) => [field, rcp[field].map(verifyItem)]),
  );
  return { ...rcp, ...verifiedFields } as RoleContextPackage;
}
