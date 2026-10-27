import { listCustomMcp } from "@/lib/custom-mcp";
import { roomateAvailable } from "@/lib/roomate-filing";

export const runtime = "nodejs";

// GET /api/council/roomate → { available } : whether an enabled org-wide
// custom MCP server named "Roomate" exists, so meeting action items can offer
// "Send to Roomate". Only the boolean leaves the server (never URLs or headers).
export async function GET() {
  const available = roomateAvailable(await listCustomMcp());
  return Response.json({ available }, { headers: { "Cache-Control": "no-store" } });
}
