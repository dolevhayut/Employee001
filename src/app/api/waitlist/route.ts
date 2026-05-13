import { NextResponse } from "next/server";

type WaitlistBody = {
  fullName?: string;
  email?: string;
  companyName?: string;
  roleTitle?: string;
  companySize?: string;
  useCase?: string;
  toolsUsed?: string;
};

const MAX = 500;

function trim(s: unknown, max: number): string {
  if (typeof s !== "string") return "";
  return s.trim().slice(0, max);
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function POST(req: Request) {
  let body: WaitlistBody;
  try {
    body = (await req.json()) as WaitlistBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const fullName = trim(body.fullName, MAX);
  const email = trim(body.email, MAX).toLowerCase();
  const companyName = trim(body.companyName, MAX);
  const roleTitle = trim(body.roleTitle, MAX);
  const companySize = trim(body.companySize, MAX);
  const useCase = trim(body.useCase, MAX);
  const toolsUsed = trim(body.toolsUsed, MAX);

  if (!email) {
    return NextResponse.json({ error: "Email is required" }, { status: 400 });
  }
  if (!isValidEmail(email)) {
    return NextResponse.json({ error: "Invalid email address" }, { status: 400 });
  }

  const payload = {
    fullName,
    email,
    companyName,
    roleTitle,
    companySize: companySize || undefined,
    useCase: useCase || undefined,
    toolsUsed: toolsUsed || undefined,
    receivedAt: new Date().toISOString(),
  };

  const webhook = process.env.WAITLIST_WEBHOOK_URL;
  if (webhook) {
    try {
      const res = await fetch(webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        console.error("[waitlist] webhook failed", res.status);
        return NextResponse.json(
          { error: "Could not record submission" },
          { status: 502 },
        );
      }
    } catch (e) {
      console.error("[waitlist] webhook error", e);
      return NextResponse.json(
        { error: "Could not record submission" },
        { status: 502 },
      );
    }
  } else {
    console.info("[waitlist]", JSON.stringify(payload));
  }

  return NextResponse.json({ ok: true });
}
