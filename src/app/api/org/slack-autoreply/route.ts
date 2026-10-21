import { loadSlackAutoReplyConfig, saveSlackAutoReplyConfig } from "@/lib/slack-autoreply-policy";
import { sessionUserFromHeaders } from "@/lib/auth/request-user";

export const runtime = "nodejs";

// The admin's allowlist for unattended Slack replies (slack-autoreply-policy.ts).
// Admin/owner only: enforced by the route table in src/proxy.ts.

export async function GET() {
  return Response.json({ config: loadSlackAutoReplyConfig() }, { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }
  const user = sessionUserFromHeaders(request.headers);
  return Response.json({ config: saveSlackAutoReplyConfig(body, user?.id ?? "local-operator") });
}
