import { NextRequest, NextResponse } from "next/server";
import { listFeed, type FeedItemType, type FeedItemStatus } from "@/lib/feed-store";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const type = url.searchParams.get("type");
  const status = url.searchParams.get("status");
  const employeeId = url.searchParams.get("employeeId");
  const limitStr = url.searchParams.get("limit");
  const since = url.searchParams.get("since");

  const filter: Parameters<typeof listFeed>[0] = {};

  if (type) {
    const types = type.split(",").map((t) => t.trim()).filter(Boolean) as FeedItemType[];
    filter.type = types.length === 1 ? types[0] : types;
  }
  if (status) {
    const statuses = status.split(",").map((s) => s.trim()).filter(Boolean) as FeedItemStatus[];
    filter.status = statuses.length === 1 ? statuses[0] : statuses;
  }
  if (employeeId) filter.employeeId = employeeId;
  if (since) filter.since = since;
  if (limitStr) {
    const n = parseInt(limitStr, 10);
    if (!Number.isNaN(n) && n > 0) filter.limit = n;
  }

  const items = listFeed(filter);
  return NextResponse.json(items);
}
