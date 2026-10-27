import { timingSafeEqual } from "../guard";

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
  let match = false;
  for (const token of acceptedSharedTokens(env)) {
    if (timingSafeEqual(bearer, token)) match = true;
  }
  return match;
}
