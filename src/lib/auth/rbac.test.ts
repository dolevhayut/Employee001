import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { API_ROUTES, authorizeApi, authorizePage } from "./rbac";

const API_DIR = path.resolve(import.meta.dirname, "../../app/api");

function routeFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) return routeFiles(abs);
    return e.name === "route.ts" ? [abs] : [];
  });
}

const routes = routeFiles(API_DIR).map((file) => {
  const pattern = "/api/" + path.relative(API_DIR, path.dirname(file)).split(path.sep).join("/");
  const text = fs.readFileSync(file, "utf8");
  const methods = [...text.matchAll(/export (?:async )?(?:function|const) (GET|POST|PUT|PATCH|DELETE)\b/g)].map((m) => m[1]);
  return { pattern, methods };
});

describe("RBAC route table", () => {
  it("has an entry for every API route and every method it exports", () => {
    const missing: string[] = [];
    for (const { pattern, methods } of routes) {
      const entry = API_ROUTES[pattern];
      if (!entry) {
        missing.push(pattern);
        continue;
      }
      for (const m of methods) if (!(m in entry)) missing.push(`${m} ${pattern}`);
    }
    expect(missing).toEqual([]);
  });

  it("lists no route that doesn't exist", () => {
    const real = new Set(routes.map((r) => r.pattern));
    expect(Object.keys(API_ROUTES).filter((p) => !real.has(p))).toEqual([]);
  });
});

const owner = { id: "u0", role: "owner" as const };
const admin = { id: "u1", role: "admin" as const };
const approver = { id: "u2", role: "approver" as const };
const member = { id: "u3", role: "member" as const };
const employee = { id: "u4", role: "employee" as const, employeeId: "noa" };

describe("authorizeApi", () => {
  it("requires sign-in for role routes and denies unknown routes", () => {
    expect(authorizeApi("/api/org/ask", "POST", null)).toMatchObject({ allow: false, status: 401 });
    expect(authorizeApi("/api/nope", "GET", owner)).toMatchObject({ allow: false, status: 404 });
    expect(authorizeApi("/api/org/ask", "GET", owner)).toMatchObject({ allow: false, status: 403 });
  });

  it("keeps settings, audit and deletion to admins", () => {
    for (const [p, m] of [["/api/audit/export", "GET"], ["/api/org/read-allowlist", "PUT"], ["/api/org/mcp", "POST"], ["/api/employees/itai", "DELETE"], ["/api/auth/users", "POST"]] as const) {
      expect(authorizeApi(p, m, member).allow, `${m} ${p}`).toBe(false);
      expect(authorizeApi(p, m, approver).allow, `${m} ${p}`).toBe(false);
      expect(authorizeApi(p, m, admin).allow, `${m} ${p}`).toBe(true);
      expect(authorizeApi(p, m, owner).allow, `${m} ${p}`).toBe(true);
    }
  });

  it("lets approvers, and not members, decide on twin actions", () => {
    expect(authorizeApi("/api/council/approve", "POST", member).allow).toBe(false);
    expect(authorizeApi("/api/council/approve", "POST", approver).allow).toBe(true);
    expect(authorizeApi("/api/org/ask", "POST", member).allow).toBe(true);
  });

  it("limits employees to their own twin: view and revoke", () => {
    expect(authorizeApi("/api/employees/noa/file/TONE.md", "GET", employee).allow).toBe(true);
    expect(authorizeApi("/api/employees/itai/file/TONE.md", "GET", employee).allow).toBe(false);
    expect(authorizeApi("/api/employees/noa", "DELETE", employee).allow).toBe(true);
    expect(authorizeApi("/api/employees/itai", "DELETE", employee).allow).toBe(false);
    expect(authorizeApi("/api/employees/noa", "PATCH", employee).allow).toBe(false);
    expect(authorizeApi("/api/org/ask", "POST", employee).allow).toBe(false);
    expect(authorizeApi("/api/twin/chat", "POST", employee).allow).toBe(false);
  });

  it("matches literal segments before params", () => {
    expect(authorizeApi("/api/invites/bulk-revoke", "POST", null)).toMatchObject({ allow: false, status: 401 });
    expect(authorizeApi("/api/invites/inv_abc123", "GET", null)).toMatchObject({ allow: true, access: { kind: "invite" } });
  });

  it("hands webhooks, invites, login and MCP to their own checks", () => {
    expect(authorizeApi("/api/slack/composio", "POST", null)).toMatchObject({ allow: true, access: { kind: "webhook" } });
    expect(authorizeApi("/api/auth/login", "POST", null)).toMatchObject({ allow: true, access: { kind: "public" } });
    expect(authorizeApi("/api/mcp", "POST", null)).toMatchObject({ allow: true, access: { kind: "bearer" } });
  });

  it("keeps the Claude Code import to the owner: it reads the server user's own folder", () => {
    const route = "/api/employees/noa/import-claude-code";
    expect(authorizeApi(route, "POST", owner).allow).toBe(true);
    for (const caller of [admin, approver, member, employee]) {
      expect(authorizeApi(route, "POST", caller).allow, caller.role).toBe(false);
    }
  });
});

describe("authorizePage", () => {
  it("sends signed-out users to sign in, except public pages", () => {
    expect(authorizePage("/flow", null)).toMatchObject({ allow: false, status: 401 });
    expect(authorizePage("/login", null).allow).toBe(true);
    expect(authorizePage("/join", null).allow).toBe(true);
  });

  it("keeps employees on their own profile and admin pages to admins", () => {
    expect(authorizePage("/profile", employee).allow).toBe(true);
    expect(authorizePage("/flow", employee).allow).toBe(false);
    expect(authorizePage("/settings", member).allow).toBe(false);
    expect(authorizePage("/settings", admin).allow).toBe(true);
    expect(authorizePage("/council", member).allow).toBe(true);
  });
});

describe("Relay access", () => {
  const dana = { id: "u-dana", role: "member" as const, employeeId: "dana" };
  const omerEmployee = { id: "u-omer", role: "employee" as const, employeeId: "omer" };
  const admin = { id: "u-admin", role: "admin" as const };

  it("a departing person does their own handover whatever their role, and only theirs", () => {
    for (const [m, p] of [["GET", "/api/relay/dana"], ["POST", "/api/relay/dana/interview"], ["POST", "/api/relay/dana/consent"], ["PATCH", "/api/relay/dana/package"]] as const) {
      expect(authorizeApi(p, m, dana).allow, `${m} ${p}`).toBe(true);
      expect(authorizeApi(p.replace("dana", "noa"), m, dana).allow, `${m} other`).toBe(false);
    }
    expect(authorizeApi("/api/relay/omer/interview", "POST", omerEmployee).allow).toBe(true);
  });

  it("retiring, downloading and the twin list stay admin-only", () => {
    expect(authorizeApi("/api/relay/dana", "POST", dana).allow).toBe(false);
    expect(authorizeApi("/api/relay/dana/package", "GET", dana).allow).toBe(false);
    expect(authorizeApi("/api/relay", "GET", dana).allow).toBe(false);
    expect(authorizeApi("/api/relay/dana", "POST", admin).allow).toBe(true);
  });

  it("the member self-access is limited to Relay routes", () => {
    expect(authorizeApi("/api/employees/dana", "DELETE", dana).allow).toBe(false);
  });
});
