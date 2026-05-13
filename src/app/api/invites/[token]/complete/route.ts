import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { isInviteRedeemable, markInviteCompleted } from "@/lib/invites";

export const runtime = "nodejs";

type Params = { params: Promise<{ token: string }> };

const PROFILE_FILES = [
  "EXPERTISE",
  "DECISIONS",
  "CONTEXT",
  "PEOPLE",
  "PROJECTS",
  "PREFERENCES",
  "TONE",
  "BOUNDARIES",
  "EMPLOYMENT",
] as const;

type CompletePayload = {
  name?: string;
  role?: string;
  /** Map from base name (e.g. "EXPERTISE") to markdown body. */
  profile?: Partial<Record<(typeof PROFILE_FILES)[number], string>>;
};

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

/**
 * Finalise an invite. Writes a starter set of profile markdown files into
 * data/employees/{employeeId}/ and marks the invite as used.
 *
 * Body: { name, role, profile? }. profile keys are file basenames (no .md).
 * Missing keys still produce empty files so downstream readers don't break.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const { token } = await params;
  const invite = isInviteRedeemable(token);
  if (!invite) {
    return NextResponse.json(
      { status: "not_redeemable" },
      { status: 410 },
    );
  }

  let body: CompletePayload = {};
  try {
    body = (await request.json()) as CompletePayload;
  } catch {
    return NextResponse.json({ status: "invalid_body" }, { status: 400 });
  }

  const name = (body.name || invite.name || "").trim();
  if (!name) {
    return NextResponse.json({ status: "name_required" }, { status: 400 });
  }
  const role = (body.role || invite.role || "").trim();

  const slug = slugify(name);
  if (!slug) {
    return NextResponse.json({ status: "name_invalid" }, { status: 400 });
  }
  const employeeId = `${slug}-${token.slice(4, 10)}`;
  const dir = path.join(process.cwd(), "data", "employees", employeeId);
  await fs.mkdir(dir, { recursive: true });

  const profile = body.profile ?? {};
  await Promise.all(
    PROFILE_FILES.map((key) => {
      const body = (profile[key] ?? "").trim() || `# ${key}\n\n_To fill in._\n`;
      return fs.writeFile(path.join(dir, `${key}.md`), body, "utf8");
    }),
  );

  // Tiny metadata sidecar so downstream code knows who this is.
  await fs.writeFile(
    path.join(dir, "employee.json"),
    JSON.stringify(
      {
        id: employeeId,
        name,
        role: role || null,
        createdAt: new Date().toISOString(),
        via: { invite: token },
      },
      null,
      2,
    ),
    "utf8",
  );

  const updated = markInviteCompleted(token, employeeId);
  return NextResponse.json({ status: "completed", employeeId, invite: updated });
}
