import { createHash, timingSafeEqual } from "node:crypto";

// EMPLOYEE001_MCP_TOKEN / EMPLOYEE001_TOKEN are shared secrets: whoever holds
// one is nobody in particular. Once personal sign-in is on they are refused
// unless an admin opts in on purpose. With personal sign-in off, behaviour is
// unchanged. This only ever tightens.

type Env = Record<string, string | undefined>;

const truthy = (value: string | undefined) => /^(1|true|yes|on)$/i.test(value?.trim() ?? "");

export function personalSignInEnabled(env: Env = process.env): boolean {
  return truthy(env.EMPLOYEE001_MCP_PERSONAL_SIGNIN);
}

export function sharedTokenAllowed(env: Env = process.env): boolean {
  if (!personalSignInEnabled(env)) return true;
  return truthy(env.EMPLOYEE001_MCP_ALLOW_SHARED_TOKEN);
}

/** Shared tokens currently acceptable (empty when the policy turns them off). */
export function acceptedSharedTokens(env: Env = process.env): string[] {
  if (!sharedTokenAllowed(env)) return [];
  return [env.EMPLOYEE001_MCP_TOKEN, env.EMPLOYEE001_TOKEN].filter((t): t is string =>
    Boolean(t),
  );
}

/** Constant-time check of a presented bearer against the allowed shared tokens. */
export function matchesSharedToken(bearer: string, env: Env = process.env): boolean {
  // Compare fixed-length digests so neither the length nor the content of a
  // token leaks through timing.
  const digest = (value: string) => createHash("sha256").update(value).digest();
  const presented = digest(bearer);
  let match = false;
  for (const token of acceptedSharedTokens(env)) {
    if (timingSafeEqual(presented, digest(token))) match = true;
  }
  return match;
}
