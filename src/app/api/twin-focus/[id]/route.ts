import { NextRequest, NextResponse } from "next/server";
import { getFocusConfig, setFocusConfig, type FocusConfig } from "@/lib/twin-focus";

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  return NextResponse.json(getFocusConfig(id));
}

export async function PUT(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const body = (await req.json().catch(() => null)) as Partial<FocusConfig> | null;
  if (!body || !Array.isArray(body.prefetches)) {
    return NextResponse.json(
      { error: "body must be { prefetches: [...] }" },
      { status: 400 }
    );
  }
  for (const p of body.prefetches) {
    if (
      !p ||
      typeof p.label !== "string" ||
      typeof p.toolSlug !== "string" ||
      typeof p.arguments !== "object" ||
      p.arguments === null
    ) {
      return NextResponse.json(
        { error: "each prefetch needs string label, string toolSlug, and object arguments" },
        { status: 400 }
      );
    }
  }
  setFocusConfig(id, { prefetches: body.prefetches });
  return NextResponse.json(getFocusConfig(id));
}
