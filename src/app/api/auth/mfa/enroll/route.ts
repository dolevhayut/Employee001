import { NextResponse } from "next/server";
import { getUser, updateUser } from "@/lib/auth/store";
import { sessionUserFromHeaders } from "@/lib/auth/request-user";
import { newTotpSecret, otpauthUri } from "@/lib/auth/totp";

export const runtime = "nodejs";

/** Start TOTP enrollment for the signed-in user: returns the secret and
 *  otpauth URI. MFA turns on only after /mfa/confirm with a valid code. */
export async function POST(request: Request) {
  const me = sessionUserFromHeaders(request.headers);
  const user = me ? getUser(me.id) : undefined;
  if (!user) return NextResponse.json({ error: "Create an account first (Settings → Users)." }, { status: 400 });
  if (user.totp?.enabled) return NextResponse.json({ error: "Two-factor sign-in is already on." }, { status: 409 });
  const secret = newTotpSecret();
  updateUser(user.id, { totp: { secret, enabled: false, lastStep: -1 } });
  return NextResponse.json({ secret, uri: otpauthUri(secret, user.email) }, { headers: { "Cache-Control": "no-store" } });
}
