import { NextRequest } from "next/server";
import { getComposio, isComposioConfigured } from "@/lib/composio-client";

export type ToolkitSummary = {
  slug: string;
  name: string;
  description?: string;
  iconUrl?: string;
  authSchemes?: string[];
  toolsCount?: number;
  triggersCount?: number;
  noAuth?: boolean;
};

/**
 * GET /api/connections/toolkits
 * Returns the full Composio catalog as a flat list of summaries the UI can render.
 */
export async function GET(_req: NextRequest) {
  if (!isComposioConfigured()) {
    return new Response(
      JSON.stringify({ error: "COMPOSIO_API_KEY is not set", toolkits: [] }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    const composio = getComposio();
    // Pull the whole catalog. The SDK paginates by default; we ask for max items.
    const response = await composio.toolkits.get({ limit: 2000 });

    // Response shape (camelCased): { items: [{ slug, name, meta?, ... }] }
    const items =
      (response as {
        items?: Array<Record<string, unknown>>;
      }).items ?? (response as unknown as Array<Record<string, unknown>>);
    const list = Array.isArray(items) ? items : [];

    const toolkits: ToolkitSummary[] = list.map((t) => {
      const meta = (t.meta as Record<string, unknown>) ?? {};
      const logo =
        (meta.logo as string) ??
        (t.logo as string) ??
        undefined;
      const description =
        (meta.description as string) ??
        (t.description as string) ??
        undefined;
      const authSchemes =
        (t.authSchemes as string[]) ??
        (meta.authSchemes as string[]) ??
        [];
      const toolsCount =
        (t.toolsCount as number) ??
        (meta.toolsCount as number) ??
        (t.actionsCount as number) ??
        undefined;
      const triggersCount =
        (t.triggersCount as number) ?? (meta.triggersCount as number);
      const noAuth =
        Array.isArray(authSchemes) && authSchemes.includes("NO_AUTH");

      return {
        slug: String(t.slug ?? t.name ?? "").toLowerCase(),
        name: String(t.name ?? t.slug ?? ""),
        description,
        iconUrl: logo,
        authSchemes,
        toolsCount,
        triggersCount,
        noAuth,
      };
    });

    // Stable: alpha order
    toolkits.sort((a, b) => a.name.localeCompare(b.name));

    return new Response(JSON.stringify({ toolkits }), {
      headers: {
        "Content-Type": "application/json",
        // Cache the catalog briefly — it doesn't change often
        "Cache-Control": "public, max-age=300, stale-while-revalidate=600",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: message, toolkits: [] }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
