// The signed-in user for a request, as src/proxy.ts resolved it. The proxy
// strips these headers from every incoming request and sets them only after
// verifying the session, so route handlers can trust them.

export const USER_ID_HEADER = "x-e001-user-id";
export const USER_ROLE_HEADER = "x-e001-user-role";
export const USER_EMPLOYEE_HEADER = "x-e001-user-employee";

export type Role = "owner" | "admin" | "approver" | "member" | "employee";
export const ROLES: readonly Role[] = ["owner", "admin", "approver", "member", "employee"];

export type RequestUser = { id: string; role: Role; employeeId?: string };

export function sessionUserFromHeaders(headers: Headers): RequestUser | null {
  const id = headers.get(USER_ID_HEADER);
  const role = headers.get(USER_ROLE_HEADER) as Role | null;
  if (!id || !role || !ROLES.includes(role)) return null;
  const employeeId = headers.get(USER_EMPLOYEE_HEADER) ?? undefined;
  return { id, role, ...(employeeId ? { employeeId } : {}) };
}
