import { NextRequest, NextResponse } from "next/server";
import { resolveFeedItem } from "@/lib/feed-store";

type Body = {
  resolution?: "approved" | "rejected" | "dismissed";
  note?: string;
};

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const body = (await req.json().catch(() => ({}))) as Body;
  const { resolution, note } = body;

  if (!resolution || !["approved", "rejected", "dismissed"].includes(resolution)) {
    return NextResponse.json(
      { error: "resolution must be one of approved | rejected | dismissed" },
      { status: 400 }
    );
  }

  const updated = resolveFeedItem(id, resolution, note);
  if (!updated) {
    return NextResponse.json({ error: "feed item not found" }, { status: 404 });
  }

  return NextResponse.json(updated);
}
