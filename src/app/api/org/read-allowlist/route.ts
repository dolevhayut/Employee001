import { loadReadAllowlist, saveReadAllowlist } from "@/lib/read-allowlist";
import { sessionUserFromHeaders } from "@/lib/auth/request-user";

export const runtime = "nodejs";

// Which external sources twins may read without asking. Admin/owner only:
// enforced by the route table in src/proxy.ts.

export async function GET() {
  return Response.json({ allowlist: loadReadAllowlist() }, { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }
  const user = sessionUserFromHeaders(request.headers);
  return Response.json({ allowlist: saveReadAllowlist(body, user?.id ?? "local-operator") });
}
