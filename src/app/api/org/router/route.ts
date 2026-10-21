import { NextRequest } from "next/server";
import { pickTwins, readyTwins } from "@/lib/org-ask";

// POST /api/org/router { question } → which twins should answer, and why.
// `by` says which picked: the keyword scorer or the Haiku fallback.
// (/api/org/ask does this itself; this endpoint is for inspection and tests.)
export async function POST(req: NextRequest) {
  let question = "";
  try {
    question = String(((await req.json()) as { question?: unknown }).question ?? "").trim();
  } catch {
    // fall through to the 400
  }
  if (!question) return Response.json({ error: "question is required" }, { status: 400 });
  const result = await pickTwins(question, await readyTwins());
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}
