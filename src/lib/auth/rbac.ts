// Role-based access, enforced in src/proxy.ts for every request once accounts
// exist. One table for every API route (a test fails when a route.ts has no
// entry) and a short list for pages. Unknown API paths are denied.
//
// Roles, highest first:
//   owner     everything, including managing owners
//   admin     settings, connections, org config, allowlists, audit, deletion
//   approver  member + approve or deny twin actions
//   member    use the product: ask, chat, Team Meeting, tasks, view twins
//   employee  self only: view their own twin and revoke consent

import type { Role } from "./request-user";

export const ROLE_RANK: Record<Role, number> = { employee: 1, member: 2, approver: 3, admin: 4, owner: 5 };

/** Who may call. "public": anyone (the handler authenticates, e.g. login);
 *  "invite": an invite token in the path is the credential; "webhook": a
 *  signed delivery, verified by the handler; "bearer": the MCP client token
 *  or a signed-in member. */
export type Access =
  | { kind: "public" }
  | { kind: "invite" }
  | { kind: "webhook" }
  | { kind: "bearer" }
  | { kind: "role"; min: Role; self?: string; selfAnyRole?: boolean };

const pub: Access = { kind: "public" };
const invite: Access = { kind: "invite" };
const webhook: Access = { kind: "webhook" };
const role = (min: Role, self?: string): Access => ({ kind: "role", min, ...(self ? { self } : {}) });
/** Like role(min, self), but the person's own record is open to them whatever
 *  their role (a departing member or approver does their own handover). */
const ownOrRole = (min: Role, self: string): Access => ({ kind: "role", min, self, selfAnyRole: true });
const employee = role("employee");
const member = role("member");
const approver = role("approver");
const admin = role("admin");

type Methods = Partial<Record<"GET" | "POST" | "PUT" | "PATCH" | "DELETE", Access>>;

/** Every API route. Paths use the app router's [param] segments. */
export const API_ROUTES: Record<string, Methods> = {
  // Sign-in
  "/api/auth/login": { POST: pub },
  "/api/auth/logout": { POST: pub },
  "/api/auth/me": { GET: pub },
  "/api/auth/mfa/verify": { POST: pub },
  "/api/auth/mfa/enroll": { POST: employee },
  "/api/auth/mfa/confirm": { POST: employee },
  "/api/auth/mfa/disable": { POST: employee },
  "/api/auth/password": { POST: employee },
  "/api/auth/oidc/start": { GET: pub },
  "/api/auth/oidc/callback": { GET: pub },
  "/api/auth/setup": { GET: pub, POST: pub },
  "/api/auth/users": { GET: admin, POST: admin },
  "/api/auth/users/[id]": { PATCH: admin, DELETE: admin },

  // Inbound, verified by the handler
  "/api/email/composio": { POST: webhook },
  "/api/slack/composio": { POST: webhook },
  "/api/mcp": { GET: { kind: "bearer" }, POST: { kind: "bearer" }, DELETE: { kind: "bearer" } },

  // Employee onboarding: the invite token is the credential
  "/api/invites/[token]": { GET: invite, DELETE: admin },
  "/api/invites/[token]/complete": { POST: invite },
  "/api/invites/[token]/connections": { GET: invite },
  "/api/invites/[token]/connections/initiate": { POST: invite },
  "/api/invites/[token]/connections/[toolkit]/disconnect": { POST: invite },
  "/api/invites": { GET: admin, POST: admin },
  "/api/invites/bulk-revoke": { POST: admin },

  // Twins (employee: their own only)
  "/api/employees": { GET: employee }, // the handler filters to the caller's own twin
  "/api/employees/[id]": { PATCH: admin, DELETE: role("admin", "id") }, // employee: revoke own consent
  "/api/employees/[id]/chat-history": { GET: member, POST: member, DELETE: admin },
  "/api/employees/[id]/file/[name]": { GET: role("member", "id"), PUT: admin },
  "/api/employees/[id]/graph": { GET: role("member", "id") },
  "/api/employees/[id]/knowledge": { GET: role("member", "id"), POST: admin },
  "/api/employees/[id]/knowledge-folders": { GET: admin, POST: admin, DELETE: admin },
  "/api/employees/[id]/knowledge/[name]": { GET: role("member", "id"), PUT: admin, DELETE: admin },
  "/api/employees/[id]/knowledge/[name]/versions": { GET: role("member", "id") },
  "/api/employees/[id]/knowledge/[name]/versions/[ts]": { GET: role("member", "id") },
  "/api/employees/[id]/knowledge/[name]/versions/[ts]/restore": { POST: admin },
  "/api/employees/[id]/knowledge/proposals": { GET: member, POST: member },
  "/api/employees/[id]/knowledge/proposals/[pid]": { POST: admin },
  "/api/employees/[id]/skills": { GET: member, PATCH: admin },
  "/api/employees/[id]/task": { POST: member },
  "/api/employees/[id]/versions/builds": { GET: role("member", "id") },
  "/api/employees/[id]/versions/file/[name]": { GET: role("member", "id") },
  "/api/employees/[id]/versions/file/[name]/[ts]": { GET: role("member", "id") },
  "/api/employees/[id]/versions/restore-build": { POST: admin },
  "/api/employees/[id]/versions/restore-file": { POST: admin },
  "/api/consent/required": { GET: member },
  "/api/connections/[id]": { GET: role("admin", "id") },
  "/api/connections/[id]/debug": { GET: admin },
  "/api/connections/[id]/disconnect": { POST: role("admin", "id") },
  "/api/connections/[id]/initiate": { POST: role("admin", "id") },
  "/api/connections/toolkits": { GET: member },
  "/api/twin-builder/[employeeId]": { POST: admin },
  "/api/twins/self": { POST: admin },
  "/api/twins/self/interview": { POST: admin },
  "/api/twin-builder/[employeeId]/active": { GET: member },
  "/api/twin-builder/[employeeId]/stream": { GET: member },
  "/api/twin-builder/active": { GET: member },
  "/api/twin-focus/[id]": { GET: member, PUT: member },
  // Relay: admins run the lifecycle; the departing employee does their own
  // interview, consent and review (approval itself is admin-only, in-route).
  "/api/relay": { GET: admin },
  "/api/relay/[employeeId]": { GET: ownOrRole("admin", "employeeId"), POST: admin },
  "/api/relay/[employeeId]/interview": { POST: ownOrRole("admin", "employeeId") },
  "/api/relay/[employeeId]/synthesize": { POST: ownOrRole("admin", "employeeId") },
  "/api/relay/[employeeId]/consent": { POST: ownOrRole("admin", "employeeId") },
  "/api/relay/[employeeId]/package": { GET: admin, PATCH: ownOrRole("admin", "employeeId") },

  // Using the product
  "/api/twin/chat": { POST: member },
  "/api/twin/upload": { POST: member },
  "/api/org/ask": { POST: member },
  "/api/org/router": { POST: member },
  "/api/council/chat": { POST: member },
  "/api/council/summary": { POST: member },
  "/api/council/export": { GET: member },
  "/api/council/file": { GET: member },
  "/api/council/meetings": { GET: member },
  "/api/council/meetings/[id]": { GET: member, DELETE: admin },
  "/api/council/meetings/[id]/roomate": { POST: member },
  "/api/council/roomate": { GET: member },
  "/api/council/approve": { POST: approver },
  "/api/approvals/pending": { GET: member },
  "/api/feed": { GET: member },
  "/api/feed/[id]/resolve": { POST: approver },
  "/api/stt": { POST: member },
  "/api/stt/token": { POST: member },
  "/api/tts": { POST: member },
  "/api/tts/stream": { POST: member },
  "/api/tts/token": { POST: member },
  "/api/tts/voices": { GET: member },
  "/api/tasks": { GET: member },
  "/api/tasks/[id]": { GET: member },
  "/api/tasks/costs": { GET: member },
  "/api/twin-tasks": { GET: member },
  "/api/work-items": { GET: member, POST: member },
  "/api/runs/[id]/log": { GET: member },
  "/api/shifts": { GET: member },
  "/api/shifts/[runId]": { GET: member },
  "/api/active-runs": { GET: member },
  "/api/active-runs/stream": { GET: member },
  "/api/goals": { GET: member, POST: member },
  "/api/goals/[id]": { GET: member, PATCH: member, DELETE: admin },
  "/api/playbooks": { GET: member, POST: admin },
  "/api/playbooks/[id]": { GET: member, PATCH: admin, DELETE: admin },
  "/api/playbooks/[id]/run": { POST: member },
  "/api/routines": { GET: member, POST: admin },
  "/api/routines/[id]": { PATCH: admin, DELETE: admin },
  "/api/routines/[id]/run": { POST: admin },
  "/api/templates": { GET: member, POST: admin },
  "/api/templates/[id]": { PATCH: admin, DELETE: admin },
  "/api/marketplace/agents": { GET: member },
  "/api/marketplace/hire": { POST: admin },
  "/api/marketplace/hired/[id]": { DELETE: admin },
  "/api/marketplace/trial-chat": { POST: member },
  "/api/demo": { GET: member },
  "/api/demo/audio/[id]": { GET: member },
  "/api/model-provider": { GET: member },
  "/api/budgets": { GET: member },
  "/api/budgets/[id]": { GET: member, PUT: admin },
  "/api/telemetry": { GET: member, POST: admin },
  "/api/system/mode": { GET: member, PATCH: admin },

  // Company knowledge and configuration
  "/api/org/brain": { GET: member, POST: admin },
  "/api/org/brain/[slug]": { GET: member, PATCH: admin, DELETE: admin },
  "/api/org/brain/builder": { POST: admin },
  "/api/org/brain/graph": { GET: member },
  "/api/org/graph": { GET: member },
  "/api/org/identity": { GET: member, PUT: admin },
  "/api/org/skills": { GET: member, POST: admin },
  "/api/org/skills/[id]": { GET: member, PATCH: admin },
  "/api/org/skills/import": { POST: admin },
  "/api/org/mcp": { GET: admin, POST: admin },
  "/api/org/mcp/[id]": { PATCH: admin, DELETE: admin },
  "/api/org/mcp/oauth/start": { POST: admin },
  "/api/org/mcp/oauth/callback": { GET: admin },
  "/api/org/read-allowlist": { GET: admin, PUT: admin },
  "/api/org/slack-autoreply": { GET: admin, PUT: admin },
  "/api/system/config": { GET: member, PATCH: admin }, // GET: key presence booleans only
  "/api/system/composio-check": { GET: member, POST: admin },
  "/api/ops-health": { GET: admin },
  "/api/audit": { GET: admin },
  "/api/audit/export": { GET: admin },
  "/api/audit/verify": { GET: admin },
};

/** Pages anyone may open (they handle their own credential). */
const PUBLIC_PAGES = [/^\/login(\/|$)/, /^\/signup(\/|$)/, /^\/forgot-password(\/|$)/, /^\/auth(\/|$)/, /^\/join(\/|$)/, /^\/onboarding(\/|$)/, /^\/welcome(\/|$)/];
/** Pages an employee-role user may open. */
const EMPLOYEE_PAGES = [/^\/$/, /^\/profile(\/|$)/, /^\/account(\/|$)/, /^\/handover\/interview(\/|$)/];
/** Admin-only pages. */
const ADMIN_PAGES = [/^\/build-my-twin(\/|$)/, /^\/settings(\/|$)/, /^\/audit(\/|$)/, /^\/connections(\/|$)/, /^\/budgets(\/|$)/, /^\/handover\/?$/];

type Compiled = { pattern: string; re: RegExp; params: string[]; methods: Methods };

const COMPILED: Compiled[] = Object.entries(API_ROUTES)
  .map(([pattern, methods]) => {
    const params: string[] = [];
    const re = new RegExp(
      "^" +
        pattern.replace(/\[([^\]]+)\]/g, (_m, name: string) => {
          params.push(name);
          return "([^/]+)";
        }) +
        "/?$",
    );
    return { pattern, re, params, methods };
  })
  // Literal segments beat params: "/api/invites/bulk-revoke" before "[token]".
  .sort((a, b) => a.params.length - b.params.length);

export function matchApiRoute(pathname: string): { pattern: string; methods: Methods; params: Record<string, string> } | null {
  for (const c of COMPILED) {
    const m = c.re.exec(pathname);
    if (!m) continue;
    const params: Record<string, string> = {};
    c.params.forEach((name, i) => {
      params[name] = decodeURIComponent(m[i + 1]);
    });
    return { pattern: c.pattern, methods: c.methods, params };
  }
  return null;
}

export type Caller = { id: string; role: Role; employeeId?: string } | null;

export type Decision =
  | { allow: true; access: Access }
  | { allow: false; status: 401 | 403 | 404; reason: string };

/** API access for a method + path. Special kinds (public, invite, webhook,
 *  bearer) are returned for the proxy to handle. */
export function authorizeApi(pathname: string, method: string, caller: Caller): Decision {
  const route = matchApiRoute(pathname);
  if (!route) return { allow: false, status: 404, reason: "unknown route" };
  const verb = (method === "HEAD" ? "GET" : method) as keyof Methods;
  const access = route.methods[verb];
  if (!access) return { allow: false, status: 403, reason: `${method} not allowed on ${route.pattern}` };
  if (access.kind !== "role") return { allow: true, access };
  if (!caller) return { allow: false, status: 401, reason: "sign in required" };
  if (ROLE_RANK[caller.role] >= ROLE_RANK[access.min]) return { allow: true, access };
  if (access.self && (caller.role === "employee" || access.selfAnyRole) && caller.employeeId && route.params[access.self] === caller.employeeId) {
    return { allow: true, access };
  }
  return { allow: false, status: 403, reason: `${route.pattern} needs the ${access.min} role` };
}

export function authorizePage(pathname: string, caller: Caller): Decision {
  if (PUBLIC_PAGES.some((re) => re.test(pathname))) return { allow: true, access: pub };
  if (!caller) return { allow: false, status: 401, reason: "sign in required" };
  if (caller.role === "employee") {
    return EMPLOYEE_PAGES.some((re) => re.test(pathname))
      ? { allow: true, access: employee }
      : { allow: false, status: 403, reason: "employees can see only their own twin" };
  }
  if (ADMIN_PAGES.some((re) => re.test(pathname)) && ROLE_RANK[caller.role] < ROLE_RANK.admin) {
    return { allow: false, status: 403, reason: "admin only" };
  }
  return { allow: true, access: member };
}
