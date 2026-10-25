import { describe, expect, it } from "vitest";
import { previewMarkdown } from "./page";

describe("previewMarkdown", () => {
  it("keeps frontmatter in raw state but omits it from rendered markdown", () => {
    expect(
      previewMarkdown(`---
employee: ava
file: CONTEXT.md
generatedAt: 2026-10-25T18:00:00.000Z
sources: [github]
confidenceNote: "high — corroborated by recent PRs"
---
# Product context`)
    ).toEqual({
      body: "# Product context",
      confidenceNote: "high — corroborated by recent PRs",
    });
  });

  it("leaves markdown without leading frontmatter unchanged", () => {
    expect(previewMarkdown("# Product context")).toEqual({
      body: "# Product context",
    });
  });
});
