import { NextRequest } from "next/server";
import {
  getComposio,
  composioUserIdFor,
  refreshConnections,
} from "@/lib/composio-client";

/** Debug: shows what Composio actually returns for this employee. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const userId = composioUserIdFor(id);
  const composio = getComposio();

  const state = await refreshConnections(id);
  const activeToolkits = Object.values(state.connections)
    .filter((c) => c.status === "ACTIVE")
    .map((c) => c.toolkit);

  const tools: unknown[] = [];
  const perToolkitCounts: Record<string, number> = {};
  let toolError: string | null = null;
  try {
    for (const toolkit of activeToolkits) {
      const fetched = await composio.tools.get(userId, {
        toolkits: [toolkit],
        important: true,
        limit: 50,
      });
      const arr = Array.isArray(fetched) ? fetched : [fetched];
      perToolkitCounts[toolkit] = arr.length;
      tools.push(...arr);
    }
  } catch (err) {
    toolError = err instanceof Error ? err.message : String(err);
  }

  // Reach into a tool and return its name/slug for readability
  type T = { name?: string; slug?: string };
  const toolNames = tools.map((t) => {
    const v = t as T;
    return v.name ?? v.slug ?? "(unknown)";
  });

  return new Response(
    JSON.stringify(
      {
        userId,
        activeToolkits,
        perToolkitCounts,
        toolCount: tools.length,
        toolNames,
        toolError,
      },
      null,
      2
    ),
    { headers: { "Content-Type": "application/json" } }
  );
}
