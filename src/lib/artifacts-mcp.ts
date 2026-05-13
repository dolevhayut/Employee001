import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

/**
 * In-process MCP server exposing a single `create_artifact` tool.
 *
 * The agent calls this when it wants to render a small visual block in the
 * chat (mini-dashboard, chart, formatted card, SVG diagram). The handler
 * itself does nothing — it just returns a confirmation. The chat UI watches
 * for `tool_use` blocks with this name and renders the `content` payload
 * inside a sandboxed iframe.
 *
 * Why a tool (and not parsing text for ```html blocks): the model's intent
 * is explicit, the schema validates the shape, and old chats without this
 * tool keep working untouched.
 */
export function buildArtifactsMcpServer() {
  return createSdkMcpServer({
    name: "artifacts",
    version: "1.0.0",
    tools: [
      tool(
        "create_artifact",
        [
          "Render a visual artifact (mini-dashboard, chart, card, diagram) inline in the chat.",
          "The user will see it as a rendered panel directly under your reply — NOT as raw code.",
          "Use this when the user asks for a dashboard, visualization, comparison table styled as a card, KPI tiles, an SVG diagram, or any UI you want them to *see*, not just read about.",
          "Do not use it for plain prose, simple markdown tables, or one-liner numbers — those belong in the regular reply.",
          "After calling the tool, briefly tell the user what you rendered (1 sentence).",
        ].join(" "),
        {
          type: z
            .enum(["html", "svg"])
            .describe(
              "html = self-contained HTML fragment (inline <style> ok, no external scripts). svg = a single <svg>...</svg> element."
            ),
          title: z
            .string()
            .min(1)
            .max(80)
            .describe("Short title shown above the rendered panel."),
          content: z
            .string()
            .min(1)
            .describe(
              "Full markup. For type=html: a complete HTML fragment that renders standalone — include any styling inline. For type=svg: one <svg> element with width/height attributes."
            ),
        },
        async ({ title }) => ({
          content: [
            {
              type: "text",
              text: `Artifact "${title}" was rendered to the user above this message.`,
            },
          ],
        })
      ),
    ],
  });
}

/** Bare tool name (after stripping the `mcp__artifacts__` prefix). */
export const ARTIFACT_TOOL_NAME = "create_artifact";
/** Full prefixed name as it appears in agent tool_use events. */
export const ARTIFACT_TOOL_FULL_NAME = "mcp__artifacts__create_artifact";

export type ArtifactPayload = {
  type: "html" | "svg";
  title: string;
  content: string;
};
