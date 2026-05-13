import { NextRequest } from "next/server";
import { dismissAgent } from "@/lib/hired-agents";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const removed = dismissAgent(id);
  if (!removed) {
    return Response.json({ error: "agent not found" }, { status: 404 });
  }
  return Response.json({ success: true });
}
