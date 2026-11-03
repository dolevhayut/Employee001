import { describe, expect, it } from "vitest";
import { filterProfilingContent, memoryRedactionLevel, profilingCategoryOf, redactSensitive } from "./sensitive-content";

describe("profiling filter (adversarial samples)", () => {
  const cases: Array<[string, string]> = [
    ["- Took two weeks of medical leave after her surgery in March", "special_category"],
    ["- Prefers async because of his ADHD", "special_category"],
    ["- She's pregnant and will be out in Q2", "special_category"],
    ["- Active in the works council; organised the 2025 strike", "special_category"],
    ["- Keeps Shabbat, so never schedule Friday evening calls", "special_category"],
    ["- Mentioned he is gay during the offsite", "special_category"],
    ["- Votes for the Labour party", "special_category"],
    ["- שומרת שבת ולא עונה בסופ\"ש", "special_category"],
    ["- חבר בוועד העובדים", "special_category"],
    ["- אובחנה בדיכאון בשנה שעברה", "special_category"],
    ["- Underperforming since the reorg; likely flight risk", "performance_judgment"],
    ["- Not committed to the team, probably interviewing elsewhere", "performance_judgment"],
    ["- Lazy on code reviews", "performance_judgment"],
    ["- עובד חלש, צריך לפטר", "performance_judgment"],
    ["- Usually logs in at 11:30am and works until 2am", "work_hours"],
    ["- Always online on weekends", "work_hours"],
    ["- Replies to Slack after midnight most days", "work_hours"],
    ["- עובדת עד מאוחר כמעט כל לילה", "work_hours"],
  ];

  it.each(cases)("flags %s", (line, category) => {
    expect(profilingCategoryOf(line)).toBe(category);
  });

  it("keeps ordinary work content", () => {
    for (const line of [
      "- Owns the pricing model for enterprise deals",
      "- Decided to move billing to Stripe in 2026 because invoicing errors cost 3% of revenue",
      "- Writes short, direct replies; signs off with 'thanks'",
      "- Reviews pull requests for the payments service",
      "- מחליטה על תמחור עסקאות אנטרפרייז",
    ]) {
      expect(profilingCategoryOf(line), line).toBeNull();
    }
  });

  it("strips profiling lines from a generated DECISIONS.md and reports them", () => {
    const md = [
      "# Decisions — Noa",
      "",
      "- Chose Postgres over Mongo for audit needs",
      "- Underperforming lately, possibly job hunting",
      "- Prefers written proposals before meetings",
      "Noa approves vendor contracts up to $20k. She was diagnosed with anxiety last year. She escalates the rest to the CFO with a one-page memo explaining the trade-offs and the budget impact.",
    ].join("\n");
    const { text, removed } = filterProfilingContent(md, "DECISIONS.md");
    expect(text).toContain("Chose Postgres");
    expect(text).toContain("Prefers written proposals");
    expect(text).toContain("approves vendor contracts");
    expect(text).toContain("escalates the rest");
    expect(text).not.toMatch(/Underperforming|diagnosed/);
    expect(removed.map((r) => r.category).sort()).toEqual(["performance_judgment", "special_category"]);
  });

  it("leaves BOUNDARIES.md alone: it names sensitive topics to avoid", () => {
    const md = "- Never discuss medical leave or union matters";
    expect(filterProfilingContent(md, "BOUNDARIES.md").text).toBe(md);
  });
});

describe("personal-data redaction", () => {
  it("redacts identifiers at the basic level", () => {
    const out = redactSensitive("Mail dana.levi@acme.co.il or call +972 54-123-4567. ID 123456782. Card 4111 1111 1111 1111. IBAN IL62 0108 0000 0009 9999 999.");
    expect(out).not.toMatch(/dana\.levi|54-123|4111|IL62/);
    expect(out).toContain("[email]");
    expect(out).toContain("[phone]");
    expect(out).toContain("[card]");
  });

  it("drops sentences with special-category data and keeps the rest", () => {
    const out = redactSensitive("The launch moved to May. Dana is on sick leave for chemo.\nPricing stays.");
    expect(out).toContain("The launch moved to May.");
    expect(out).toContain("Pricing stays.");
    expect(out).not.toContain("chemo");
    expect(out).toContain("[redacted: sensitive personal data]");
  });

  it("always strips secrets, even when redaction is off", () => {
    expect(redactSensitive("key sk-ant-abcdefghijklmnopqrstu and dana@x.io", "off")).toBe("key [redacted_anthropic_key] and dana@x.io");
  });

  it("strict also masks IPs and long numbers", () => {
    expect(redactSensitive("server 10.2.3.4 order 99887766", "strict")).toBe("server [ip] order [number]");
  });

  it("reads the level from EMPLOYEE001_MEMORY_REDACT", () => {
    expect(memoryRedactionLevel({})).toBe("basic");
    expect(memoryRedactionLevel({ EMPLOYEE001_MEMORY_REDACT: "STRICT" })).toBe("strict");
    expect(memoryRedactionLevel({ EMPLOYEE001_MEMORY_REDACT: "nonsense" })).toBe("basic");
  });
});

describe("redaction keeps ordinary numbers", () => {
  it("masks IDs but not times, years or amounts", () => {
    const out = redactSensitive("ID 123456782. Meeting at 10:30, budget 2026 is 40000.");
    expect(out).toBe("ID [national_id]. Meeting at 10:30, budget 2026 is 40000.");
  });
});

describe("profiling filter keeps profile frontmatter intact", () => {
  const md = [
    "---",
    "employee: noa-1a2b3c",
    "file: DECISIONS.md",
    "generatedAt: 2026-11-03T09:15:00.000Z",
    "sources: [gmail.fetch_emails, knowledge/therapy-notes.md, \"knowledge/pip-install.md\", slack]",
    "confidenceNote: \"medium, sent mail only\"",
    "---",
    "# Decisions",
    "- Chose Postgres over Mongo for audit needs",
    "- Underperforming lately, possibly job hunting",
  ].join("\n");

  it("keeps the sources key when a filename in it looks sensitive", () => {
    const { text, removed } = filterProfilingContent(md, "DECISIONS.md");
    expect(text).toContain('sources: [gmail.fetch_emails, "[redacted]", "[redacted]", slack]');
    expect(text).not.toMatch(/therapy|pip-install/);
    expect(text.startsWith("---\nemployee: noa-1a2b3c\nfile: DECISIONS.md\ngeneratedAt: 2026-11-03T09:15:00.000Z\n")).toBe(true);
    expect(text).toContain('confidenceNote: "medium, sent mail only"\n---\n# Decisions');
    // The body is still filtered as before.
    expect(text).toContain("Chose Postgres");
    expect(text).not.toContain("Underperforming");
    expect(removed.map((r) => r.category).sort()).toEqual(["performance_judgment", "performance_judgment", "special_category"]);
  });

  it("redacts block-list items and scalar values without dropping their keys", () => {
    const block = [
      "---",
      "file: TONE.md",
      "sources:",
      "  - gmail.fetch_emails",
      "  - knowledge/sick-leave-cover.md",
      "confidenceNote: low, she was on medical leave for most of the window",
      "---",
      "body",
    ].join("\r\n");
    const { text, removed } = filterProfilingContent(block, "TONE.md");
    expect(text).toBe(
      ["---", "file: TONE.md", "sources:", "  - gmail.fetch_emails", '  - "[redacted]"', 'confidenceNote: "[redacted]"', "---", "body"].join("\r\n"),
    );
    expect(removed).toHaveLength(2);
  });

  it("redacts the whole inline list when only the line as a whole profiles the person", () => {
    // Neither item matches alone; the key plus the time together do.
    for (const line of ["active: [after 11pm]", "notes: [replies, after 11pm]"]) {
      const { text, removed } = filterProfilingContent(`---\nfile: TONE.md\n${line}\n---\nbody`, "TONE.md");
      expect(text).not.toContain("11pm");
      expect(text).toContain(`${line.split(":")[0]}: ["[redacted]"]`);
      expect(removed).toHaveLength(1);
    }
  });

  it("drops a frontmatter key that itself profiles the person", () => {
    const { text } = filterProfilingContent("---\nfile: CONTEXT.md\ndiagnosis: anxiety\n---\nbody", "CONTEXT.md");
    expect(text).toBe("---\nfile: CONTEXT.md\n---\nbody");
  });

  it("treats a leading --- block as prose when no profile file is named (memory text)", () => {
    const { text } = filterProfilingContent("---\nShe was diagnosed with anxiety.\n---\nok");
    expect(text).toBe("---\n---\nok");
  });
});
