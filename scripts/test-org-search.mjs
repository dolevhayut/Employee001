// Direct test of org-brain-search, bypassing the SDK + MCP layer.
// Run from repo root: npx tsx scripts/test-org-search.mjs
import { searchOrgBrain } from "../src/lib/org-brain-search.ts";

const queries = [
  "WorkOS SSO timeline",
  "pricing decisions Notion",
  "shift state autonomous",
  "what is Maya thinking about activation",
];

for (const q of queries) {
  console.log(`\n=== ${q} ===`);
  const hits = await searchOrgBrain(q, { limit: 3 });
  for (const h of hits) {
    console.log(`  [${h.score}] ${h.sourceLabel} · ${h.file}${h.section ? " — " + h.section : ""}`);
    console.log(`    ${h.snippet.slice(0, 140).replace(/\n/g, " ")}…`);
  }
  if (hits.length === 0) console.log("  (no hits)");
}
