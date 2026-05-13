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
  /** Free-form domain string the employee provided in the wizard. */
  domain?: string;
  /** Integration toolkits the employee opted in to. */
  integrations?: string[];
  /** Slack-like channel name suggested in the wizard. */
  channel?: string;
  /** Boundary flags from the wizard's privacy step. */
  boundaries?: {
    comp?: boolean;
    hr?: boolean;
    legal?: boolean;
    customers?: boolean;
    roadmap?: boolean;
  };
  /** Optional override: explicit markdown bodies per profile file. */
  profile?: Partial<Record<(typeof PROFILE_FILES)[number], string>>;
};

function buildProfileMarkdown(
  payload: CompletePayload,
  fallbacks: { name: string; role: string },
): Record<(typeof PROFILE_FILES)[number], string> {
  const name = fallbacks.name;
  const role = fallbacks.role || "—";
  const domain = (payload.domain ?? "").trim();
  const integrations = (payload.integrations ?? []).filter(Boolean);
  const channel = (payload.channel ?? "").trim();
  const b = payload.boundaries ?? {};
  const today = new Date().toISOString().slice(0, 10);

  const out = {} as Record<(typeof PROFILE_FILES)[number], string>;

  out.EXPERTISE = [
    `# Expertise — ${name}`,
    "",
    role ? `Role: **${role}**` : "",
    domain ? `Primary domain: ${domain}` : "",
    "",
    "## What I work on",
    "",
    domain
      ? `My day-to-day centres on ${domain}.`
      : "_The employee hasn't filled this in yet._",
    integrations.length
      ? `\nSignals my twin draws on:\n${integrations.map((i) => `- ${i}`).join("\n")}`
      : "",
    "",
  ].filter(Boolean).join("\n");

  out.EMPLOYMENT = [
    `# Employment — ${name}`,
    "",
    `- Name: ${name}`,
    role ? `- Role: ${role}` : "",
    channel ? `- Preferred channel: ${channel}` : "",
    `- Onboarded: ${today}`,
    "",
  ].filter(Boolean).join("\n");

  out.BOUNDARIES = [
    `# Boundaries — ${name}`,
    "",
    "My twin will not discuss or share information about the following without",
    "explicit human approval:",
    "",
    b.comp ? "- Compensation, salary, or equity" : "",
    b.hr ? "- HR matters and personnel files" : "",
    b.legal ? "- Legal documents and contracts" : "",
    b.customers ? "- Customer names and account details" : "",
    b.roadmap ? "- Product roadmap and unreleased plans" : "",
    !(b.comp || b.hr || b.legal || b.customers || b.roadmap)
      ? "_No boundaries set yet — the employee can refine this any time from /profile._"
      : "",
    "",
  ].filter(Boolean).join("\n");

  // Files we don't synthesise from form data: leave a clear placeholder so
  // it's obvious where the employee should pick up next.
  for (const base of PROFILE_FILES) {
    if (base in out) continue;
    out[base] = `# ${base} — ${name}\n\n_To fill in. Update this file from /profile or directly on disk._\n`;
  }

  // Explicit profile overrides win.
  for (const [key, body] of Object.entries(payload.profile ?? {})) {
    if (PROFILE_FILES.includes(key as (typeof PROFILE_FILES)[number]) && body && body.trim()) {
      out[key as (typeof PROFILE_FILES)[number]] = body;
    }
  }

  return out;
}

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

  const profile = buildProfileMarkdown(body, { name, role });
  await Promise.all(
    PROFILE_FILES.map((key) =>
      fs.writeFile(path.join(dir, `${key}.md`), profile[key], "utf8"),
    ),
  );

  // Metadata sidecar — read back by loadEmployeesFromDisk() to materialise
  // the workspace's employee list.
  await fs.writeFile(
    path.join(dir, "employee.json"),
    JSON.stringify(
      {
        id: employeeId,
        name,
        role: role || null,
        integrations: (body.integrations ?? []).filter(Boolean),
        createdAt: new Date().toISOString(),
        lastActiveAt: new Date().toISOString(),
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
