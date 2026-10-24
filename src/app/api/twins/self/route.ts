import { NextResponse } from "next/server";
import { sessionUserFromHeaders } from "@/lib/auth/request-user";
import { canRunModel } from "@/lib/model-provider";
import { createSelfTwin, selfTwinProblem } from "@/lib/self-twin";

export const runtime = "nodejs";

/** "Build my twin": POST { name, role, notes, consent: true, locale? }.
 *  Creates the person's own twin from their notes (plus any documents they
 *  upload next) and starts the builder. No invite, no connected tools. */
export async function POST(request: Request) {
  let body: { name?: unknown; role?: unknown; notes?: unknown; consent?: unknown; locale?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const input = {
    name: typeof body.name === "string" ? body.name : "",
    role: typeof body.role === "string" ? body.role : "",
    notes: typeof body.notes === "string" ? body.notes : "",
  };
  const problem = selfTwinProblem(input);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });
  if (body.consent !== true) return NextResponse.json({ error: "Agree to build a twin from what you give it first." }, { status: 400 });
  const model = canRunModel();
  if (!model.ok) return NextResponse.json({ error: model.reason }, { status: 409 });

  const user = sessionUserFromHeaders(request.headers);
  const { employeeId } = await createSelfTwin({
    ...input,
    userId: user?.id,
    locale: typeof body.locale === "string" ? body.locale : undefined,
    headers: request.headers,
  });
  return NextResponse.json({ employeeId }, { status: 201 });
}
