import "server-only";
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./app-home";
import { listInvites } from "./invites";
import { purgeEmployee } from "./employee-purge";

// An invited person can connect a tool before finishing onboarding, which
// creates their folder (and live Composio connections) with no consent yet.
// If the invite is then revoked or expires, that folder is hidden from every
// list (employees-disk skips unfinished invites) and nothing would ever
// remove it. These are the folders to purge: no consent recorded, made by
// an invite that's gone, or expired without being completed.

type Sidecar = { via?: { invite?: unknown }; consent?: { scopes?: unknown }; pendingProfile?: unknown };

export function abandonedInviteTwins(now = Date.now()): string[] {
  const root = dataDir("employees");
  let ids: string[];
  try {
    ids = fs.readdirSync(root);
  } catch {
    return [];
  }
  const invites = new Map(listInvites().map((i) => [i.token, i]));
  const out: string[] = [];
  for (const id of ids) {
    let sidecar: Sidecar;
    try {
      sidecar = JSON.parse(fs.readFileSync(path.join(root, id, "employee.json"), "utf8")) as Sidecar;
    } catch {
      continue;
    }
    const token = sidecar.via?.invite;
    if (typeof token !== "string" || Array.isArray(sidecar.consent?.scopes)) continue;
    const invite = invites.get(token);
    const gone = !invite || (!invite.completedAt && new Date(invite.expiresAt).getTime() < now);
    if (gone) out.push(id);
  }
  return out;
}

/** Purges every abandoned invite folder: OAuth connections first, then the
 *  data (purgeEmployee). Returns the ids it removed. */
export async function purgeAbandonedInviteTwins(): Promise<string[]> {
  const removed: string[] = [];
  for (const id of abandonedInviteTwins()) {
    try {
      await purgeEmployee(id, "deleted");
      removed.push(id);
    } catch (err) {
      console.warn(`[invite-cleanup] could not purge ${id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return removed;
}
