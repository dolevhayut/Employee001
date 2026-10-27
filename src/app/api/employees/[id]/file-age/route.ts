import { NextRequest, NextResponse } from "next/server";
import { sessionUserFromHeaders } from "@/lib/auth/request-user";
import { confirmProfileFile, profileFileAges } from "@/lib/employees-disk";
import { isRetiredSync } from "@/lib/twin-lifecycle";

/** Age of each profile file: GET lists them. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return NextResponse.json({ ages: await profileFileAges(id) }, { headers: { "Cache-Control": "no-store" } });
}

/** "Still true": POST { file } resets one file's age without touching its content. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (isRetiredSync(id)) return NextResponse.json({ error: "This twin is retired and read-only." }, { status: 409 });
  const body = (await req.json().catch(() => ({}))) as { file?: unknown };
  if (typeof body.file !== "string") return NextResponse.json({ error: "file is required" }, { status: 400 });
  try {
    const age = await confirmProfileFile(id, body.file, sessionUserFromHeaders(req.headers) ?? undefined);
    if (!age) return NextResponse.json({ error: "unknown employee or profile file" }, { status: 404 });
    return NextResponse.json({ age });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    console.warn(`[file-age] confirm failed for ${id}: ${message}`);
    return NextResponse.json({ error: `Couldn't save the confirmation: ${message}` }, { status: 500 });
  }
}
