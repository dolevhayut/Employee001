// In-process MCP server that exposes one tool — `search_org_brain` — to every
// twin run. Lets a twin ask "what has Maya said about Notion?" or "who owns
// pricing decisions?" and get back the matching chunks across the entire
// workspace's profile files, with citations.
//
// The handler delegates to `searchOrgBrain` in org-brain-search.ts (BM25,
// local, no third-party). The MCP wrapper is just the tool surface — it's
// what the agent SDK plumbs through to the model's tool-use shape.
//
// Pattern mirrors `buildArtifactsMcpServer` in artifacts-mcp.ts: pure
// in-process, no external connection, no approval gate (the tool only
// reads files the twin can already Read directly via its sandboxed cwd —
// search is just a more efficient retrieval surface).

import "server-only";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { searchOrgBrain } from "@/lib/org-brain-search";

export function buildOrgBrainMcpServer() {
  return createSdkMcpServer({
    name: "org_brain",
    version: "1.0.0",
    tools: [
      tool(
        "search_org_brain",
        [
          "Search every employee's profile files (EXPERTISE / DECISIONS / CONTEXT / PEOPLE / PROJECTS / PREFERENCES / TONE / BOUNDARIES / EMPLOYMENT) plus any shared org-brain nodes.",
          "Use this whenever you need to answer 'what does <other person> think about X' or 'who owns Y' or 'has the CEO already decided about Z'.",
          "Faster and more accurate than reading every file with Read/Glob — the index uses BM25 scoring so it ranks hits by relevance.",
          "Returns up to `limit` chunks, each with the source employee, the file, the section heading, a snippet, and the BM25 score (for relative comparison only — don't show the number to the user).",
          "Cite the source in your answer like: 'Per Maya's DECISIONS.md (Recent calls) — …' so the user can verify.",
        ].join(" "),
        {
          query: z
            .string()
            .min(2)
            .max(200)
            .describe(
              "The search query in plain language. Keywords or a short phrase work best — e.g. 'pricing decisions Notion' beats 'what does Maya think about Notion?' because BM25 favours specific terms over function words.",
            ),
          source: z
            .string()
            .optional()
            .describe(
              "Restrict to one source. Use an employee id (e.g. 'maya-chen', 'daniel-rivera') to search only that person's files. Use 'org-brain' to search shared org-brain nodes. Omit to search everything.",
            ),
          file: z
            .string()
            .optional()
            .describe(
              "Restrict to a single profile file across all sources, e.g. 'DECISIONS.md' to scan only decision logs. Use this when the user's question maps cleanly to one file type.",
            ),
          limit: z
            .number()
            .int()
            .min(1)
            .max(20)
            .optional()
            .describe("Max results to return. Default 6, cap 20."),
        },
        async ({ query, source, file, limit }) => {
          const hits = await searchOrgBrain(query, { source, file, limit });

          if (hits.length === 0) {
            return {
              content: [
                {
                  type: "text" as const,
                  text:
                    `No matches for "${query}"` +
                    (source ? ` in source "${source}"` : "") +
                    (file ? ` in file "${file}"` : "") +
                    ". Try a different keyword or remove the filter.",
                },
              ],
            };
          }

          // The agent SDK expects a content array. Bundle the structured
          // hits as a single text block — easier for the model to reason
          // over than separate blocks per hit (each block consumes a
          // small token of overhead).
          const body = hits
            .map((h, i) => {
              const headLabel =
                h.section.length > 0 ? ` — ${h.section}` : "";
              return [
                `[${i + 1}] ${h.sourceLabel} · ${h.file}${headLabel}`,
                `    (source=${h.source} · score=${h.score})`,
                "",
                h.snippet,
              ].join("\n");
            })
            .join("\n\n---\n\n");

          return {
            content: [
              {
                type: "text" as const,
                text: `Found ${hits.length} match${hits.length === 1 ? "" : "es"}:\n\n${body}`,
              },
            ],
          };
        },
      ),
    ],
  });
}
