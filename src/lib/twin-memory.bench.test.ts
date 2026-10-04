import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { TwinMemoryCard, TwinStructuredFact } from "./twin-memory";

const EMPLOYEE_ID = "bench-employee";
const ORIGINAL_CWD = process.cwd();
const ENV_KEYS = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "TWIN_MEMORY_AGENTIC_RERANK",
  "TWIN_MEMORY_RERANK_MODEL",
  "TWIN_MEMORY_RERANK_CANDIDATES",
  "TWIN_MEMORY_DREAMER_LLM",
  "TWIN_MEMORY_DREAMER_MODEL",
  "TWIN_MEMORY_ENABLED",
  "TWIN_MEMORY_STRUCTURED_ENABLED",
  "TWIN_MEMORY_RELEVANCE_GATE",
] as const;

type MemoryModule = typeof import("./twin-memory");
type RetrievalCase = {
  label: string;
  query: string;
  expectedId?: string;
  forbiddenFirstId?: string;
  abstain?: boolean;
};

let tempDir: string;
let memory: MemoryModule;
let originalFetch: typeof globalThis.fetch;
const originalEnv = new Map<string, string | undefined>();

function card(
  id: string,
  question: string,
  answer: string,
  index: number
): TwinMemoryCard {
  return {
    id,
    employeeId: EMPLOYEE_ID,
    runId: `bench-run-${id}`,
    surface: "chat",
    content: `CEO asked: ${question}\nTwin answered: ${answer}`,
    question,
    answerPreview: answer,
    importance: 1,
    createdAt: new Date(Date.UTC(2026, 0, 1 + index)).toISOString(),
  };
}

// Deliberately distinct, durable memories. The small Hebrew slice ensures the
// offline tokenizer and relevance gate are exercised without embedding calls.
const CARDS: TwinMemoryCard[] = [
  card("pricing-pro-49", "What did we decide for Pro pricing?", "We decided to raise the Pro plan to $49 per month after the annual-plan experiment.", 0),
  card("pricing-annual", "How should annual billing work?", "Annual billing gives customers two months free and is shown beside the monthly price.", 1),
  card("hiring-backend", "What is the backend engineer interview loop?", "Use recruiter screen, coding exercise, system design, and values interview; debrief within 24 hours.", 2),
  card("hiring-designer", "What did we decide about the product designer hire?", "Hire a senior product designer in Tel Aviv after the portfolio review and paid exercise.", 3),
  card("customer-escalation", "How did we resolve Acme's outage escalation?", "Acme received a service credit after the webhook outage; Maya owns the Friday incident review.", 4),
  card("gdpr-delete", "What is the GDPR deletion process?", "For a verified GDPR deletion request, erase the customer record and audit trail within 30 days, then confirm completion.", 5),
  card("csv-import", "Why are CSV imports failing?", "The CSV importer rejects quoted commas in company names; ship the RFC4180 parser fix before the next migration.", 6),
  card("roadmap-mobile", "What is on the mobile roadmap?", "The Q3 roadmap prioritizes offline mobile approvals before analytics dashboards.", 7),
  card("roadmap-api", "What is planned for the public API?", "The public API roadmap starts with read-only projects and pagination in September.", 8),
  card("preference-meetings", "What meeting style does the CEO prefer?", "I prefer 25-minute decision meetings with a written agenda and no slide deck.", 9),
  card("security-soc2", "What is the SOC 2 plan?", "The SOC 2 evidence collection begins in August with vendor access reviews.", 10),
  card("support-sla", "What is the Enterprise support SLA?", "Enterprise customers receive a four-hour first-response SLA for production incidents.", 11),
  card("billing-stripe", "Which billing provider do we use?", "Stripe remains the billing provider; do not add a second payment processor this year.", 12),
  card("analytics-postgres", "Which database powers analytics?", "Postgres powers the analytics warehouse until query volume requires a column store.", 13),
  card("release-friday", "When do we deploy releases?", "Production releases happen on Fridays before noon with a rollback owner assigned.", 14),
  card("onboarding-security", "What is required for employee onboarding?", "New employees must complete security training and password-manager setup in their first week.", 15),
  card("partner-reseller", "What is our reseller policy?", "Resellers need written approval and may not discount below the published Pro price.", 16),
  card("incident-pager", "Who is primary on-call?", "Nora is primary pager owner for the payments service this quarter.", 17),
  card("retention-trial", "How do we improve trial conversion?", "Send the trial activation email on day two with the import checklist.", 18),
  card("legal-dpa", "What is required before a DPA is signed?", "Legal reviews every DPA before signature and stores the final PDF in the contracts vault.", 19),
  card("he-pricing", "מה החלטנו לגבי מחיר תוכנית Pro?", "החלטנו להעלות את המחיר של תוכנית Pro ל-49 דולר לחודש.", 20),
  card("he-hiring", "מה מצב הגיוס למפתח backend?", "נפתח תקן למפתח backend בכיר והראיון הטכני כולל תרגיל מערכת.", 21),
  card("he-escalation", "איך טיפלנו בהסלמה של הלקוח אוריון?", "אוריון קיבלה זיכוי שירות לאחר התקלה והפגישה עם הלקוח נקבעה ליום שני.", 22),
  card("he-gdpr", "מה עושים בבקשת מחיקה לפי GDPR?", "בקשת מחיקה מאומתת לפי GDPR מחייבת מחיקת נתוני הלקוח ושליחת אישור תוך שלושים יום.", 23),
  card("he-csv", "מה הבאג בייבוא CSV?", "ייבוא CSV נכשל כאשר שם החברה כולל פסיק בתוך מרכאות; מתקנים את המפרש השבוע.", 24),
  card("he-roadmap", "מה בעדיפות במפת הדרכים?", "במפת הדרכים של הרבעון הבא עדיפות ראשונה לאישורים במובייל במצב לא מקוון.", 25),
  card("integrations-slack", "Which chat integration ships next?", "The Slack integration ships after OAuth scope review and an admin consent screen.", 26),
  card("design-accessibility", "What accessibility rule applies to forms?", "Every form field needs a visible label, keyboard focus, and an error message linked with aria-describedby.", 27),
  card("finance-runway", "What is the current runway target?", "Keep eighteen months of runway by holding hiring outside approved roles.", 28),
  card("office-remote", "What is the remote work policy?", "The team is remote-first, with an optional Tel Aviv co-working day every Wednesday.", 29),
];

const CASES: RetrievalCase[] = [
  { label: "Pro price", query: "What monthly amount did we set for Pro?", expectedId: "pricing-pro-49" },
  { label: "backend loop", query: "Describe the engineering candidate interview stages", expectedId: "hiring-backend" },
  { label: "Acme escalation", query: "What compensation did Acme get after the webhook incident?", expectedId: "customer-escalation" },
  { label: "GDPR erase", query: "How long do verified GDPR erasure requests take?", expectedId: "gdpr-delete" },
  { label: "quoted CSV", query: "Which parser issue breaks quoted commas during import?", expectedId: "csv-import" },
  { label: "mobile roadmap", query: "Which offline approvals capability precedes analytics dashboards?", expectedId: "roadmap-mobile" },
  { label: "meeting preference", query: "What written agenda and slide-deck rule applies to decision meetings?", expectedId: "preference-meetings" },
  { label: "עברית מחיר", query: "כמה עולה תוכנית Pro אחרי ההחלטה?", expectedId: "he-pricing" },
  { label: "עברית CSV", query: "מה קורה כשיש פסיק במרכאות בייבוא CSV?", expectedId: "he-csv" },
  { label: "עברית הסלמה", query: "איזה זיכוי קיבלה אוריון אחרי התקלה?", expectedId: "he-escalation" },
  // The shared "customer data" and "CSV" vocabulary must not elevate GDPR
  // above the actual import memory.
  { label: "CSV/GDPR trap", query: "How do we handle customer data in CSV exports?", expectedId: "csv-import", forbiddenFirstId: "gdpr-delete" },
  { label: "abstain astronomy", query: "Quasar nebula telescope brightness", abstain: true },
  { label: "abstain recipes", query: "Which sourdough starter fermentation recipe works?", abstain: true },
  { label: "abstain sports", query: "Who won the basketball championship?", abstain: true },
  { label: "abstain travel", query: "Louvre impressionist painting highlight", abstain: true },
  { label: "abstain botany", query: "Orchid photosynthesis explanation", abstain: true },
];

function writeFixture(): void {
  const directory = path.join(tempDir, "data", "memory", EMPLOYEE_ID);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(
    path.join(directory, "cards.jsonl"),
    `${CARDS.map((entry) => JSON.stringify(entry)).join("\n")}\n`
  );

  const facts: TwinStructuredFact[] = [
    { id: "fact-price", employeeId: EMPLOYEE_ID, runId: "fact-run-1", type: "decision", key: "pro-price-49", value: "Pro costs $49 per month.", confidence: 0.9, source: "user", createdAt: "2026-02-01T00:00:00.000Z" },
    { id: "fact-meetings", employeeId: EMPLOYEE_ID, runId: "fact-run-2", type: "preference", key: "25-minute-meetings", value: "I prefer 25-minute decision meetings.", confidence: 0.8, source: "user", createdAt: "2026-03-01T00:00:00.000Z" },
    { id: "fact-csv-todo", employeeId: EMPLOYEE_ID, runId: "fact-run-3", type: "todo", key: "fix-csv-parser", value: "Fix the RFC4180 CSV parser.", confidence: 0.8, source: "agent", createdAt: "2026-04-01T00:00:00.000Z" },
  ];
  fs.writeFileSync(
    path.join(directory, "structured.jsonl"),
    `${facts.map((entry) => JSON.stringify(entry)).join("\n")}\n`
  );
}

beforeAll(async () => {
  for (const key of ENV_KEYS) {
    originalEnv.set(key, process.env[key]);
    delete process.env[key];
  }
  process.env.TWIN_MEMORY_ENABLED = "true";
  process.env.TWIN_MEMORY_STRUCTURED_ENABLED = "true";
  process.env.TWIN_MEMORY_RELEVANCE_GATE = "1";
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "e001-mem-"));
  originalFetch = globalThis.fetch;
  globalThis.fetch = (() => {
    throw new Error("Network access is forbidden in twin-memory benchmark");
  }) as typeof globalThis.fetch;
  process.chdir(tempDir);
  memory = await import("./twin-memory");
  writeFixture();
});

afterAll(() => {
  process.chdir(ORIGINAL_CWD);
  globalThis.fetch = originalFetch;
  for (const key of ENV_KEYS) {
    const value = originalEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("twin-memory deterministic retrieval benchmark", () => {
  it("keeps keyword recall and abstention above the offline baseline", async () => {
    let relevant = 0;
    let recalled = 0;
    let abstentions = 0;
    const rows: string[] = [];

    for (const entry of CASES) {
      const hits = await memory.searchTwinMemory(EMPLOYEE_ID, entry.query, 5);
      const ids = hits.map((hit) => hit.card.id);
      const passed = entry.abstain
        ? ids.length === 0
        : ids.includes(entry.expectedId!) && ids[0] !== entry.forbiddenFirstId;
      if (entry.abstain) abstentions += Number(passed);
      else {
        relevant++;
        recalled += Number(passed);
      }
      rows.push(`${entry.label} | ${ids.join(",") || "-"} | ${passed ? "PASS" : "FAIL"}`);
    }

    const recallAt5 = recalled / relevant;
    const abstentionAccuracy = abstentions / CASES.filter((entry) => entry.abstain).length;
    console.info(
      `[twin-memory bench] recall@5=${recallAt5.toFixed(3)} abstention=${abstentionAccuracy.toFixed(3)}\n${rows.join("\n")}`
    );

    // Calibrated from the deterministic no-embedding baseline (11/11 and 5/5);
    // leave one relevant and one abstention case of headroom for harmless ranking changes.
    expect(recallAt5).toBeGreaterThanOrEqual(10 / 11);
    expect(abstentionAccuracy).toBeGreaterThanOrEqual(4 / 5);
  });

  it("returns lexical matches first and backfills structured facts by confidence and recency", () => {
    const facts = memory.searchStructuredMemory(EMPLOYEE_ID, "What is the Pro price?", 3);
    expect(facts.map((fact) => fact.id)).toEqual([
      "fact-price",
      "fact-csv-todo",
      "fact-meetings",
    ]);
  });
});
