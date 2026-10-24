// A tiny CompanySim world for the emulator's unit tests. Ana (support) and
// Ben (account owner, project owner) share a team and a public channel; Cy is
// on another team with a private channel and a private document.

import type { Row, World } from "./world";

const DAY = 86_400_000;
const at = (daysAgo: number, now: number) => new Date(now - daysAgo * DAY).toISOString();

export const ANA = "person_ana";
export const BEN = "person_ben";
export const CY = "person_cy";

export function testWorld(now = Date.parse("2026-10-20T12:00:00Z")): World {
  const r = (id: string, rest: Record<string, unknown>): Row => ({ id, ...rest });
  const person = (id: string, first: string, last: string, team: string, role: string, manager?: string) =>
    r(id, { firstName: first, lastName: last, displayName: `${first} ${last}`, email: `${first.toLowerCase()}.${last.toLowerCase()}@acme-labs.test`, status: "active", currentTeamId: team, currentRoleId: role, currentDepartmentId: "dep_1", managerPersonId: manager, skills: [] });
  const ticket = (id: string, status: string, created: number, updated: number) =>
    r(id, { title: `Rollout question ${id}`, description: `Help validating the rollout (${id}).`, status, priority: "high", customerId: "cust_1", projectId: "proj_1", assigneePersonId: ANA, createdAt: at(created, now), updatedAt: at(updated, now) });
  return {
    people: [person(ANA, "Ana", "Lee", "team_1", "role_support", BEN), person(BEN, "Ben", "Ortiz", "team_1", "role_am"), person(CY, "Cy", "Park", "team_2", "role_eng")],
    roles: [r("role_support", { title: "Support Specialist" }), r("role_am", { title: "Account Manager" }), r("role_eng", { title: "Engineer" })],
    teams: [r("team_1", { name: "Customer Success" }), r("team_2", { name: "Platform" })],
    departments: [r("dep_1", { name: "Operations" })],
    projects: [r("proj_1", { name: "Atlas Migration", customerId: "cust_1", ownerPersonId: BEN, teamIds: ["team_1"], status: "active", priority: "high", createdAt: at(400, now) })],
    customers: [r("cust_1", { name: "Willow & Finch", accountOwnerPersonId: BEN, renewalDate: new Date(now + 20 * DAY).toISOString(), status: "active", health: 80, annualValue: 100000 })],
    contacts: [
      r("contact_1", { name: "Sam Park", title: "Operations Director", email: "sam.park@willow-finch.test", customerId: "cust_1" }),
      r("contact_2", { name: "Riley Stone", title: "IT Lead", email: "riley.stone@willow-finch.test", customerId: "cust_1" }),
    ],
    tickets: [
      ticket("t_open", "open", 3, 3),
      ticket("t_prog", "in_progress", 10, 2),
      ticket("t_wait", "waiting_on_customer", 12, 5),
      ticket("t_res", "resolved", 30, 20),
      ticket("t_closed", "closed", 60, 50),
    ],
    documents: [
      r("doc_1", { title: "Atlas Migration · Delivery plan", body: "Scope, milestones and cutover risks.", authorPersonId: ANA, projectId: "proj_1", customerId: "cust_1", visibility: "company", mimeType: "text/markdown", createdAt: at(40, now), updatedAt: at(8, now) }),
      r("doc_2", { title: "Platform notes", body: "Private scratch notes.", authorPersonId: CY, visibility: "private", mimeType: "text/markdown", createdAt: at(20, now), updatedAt: at(19, now) }),
    ],
    channels: [
      r("chan_1", { name: "customer-success", kind: "public", teamId: "team_1", createdAt: at(500, now) }),
      r("chan_2", { name: "platform-private", kind: "private", teamId: "team_2", createdAt: at(500, now) }),
    ],
    conversations: [
      r("conv_1", { channelId: "chan_1", participantPersonIds: [ANA, BEN], subject: "Delivery coordination" }),
      r("conv_2", { channelId: "chan_2", participantPersonIds: [CY], subject: "Platform" }),
    ],
    messages: [
      r("msg_1", { conversationId: "conv_1", senderPersonId: BEN, projectId: "proj_1", body: "Atlas: cutover moved to Friday.", timestamp: "2026-10-13T09:00:00.000Z" }),
      r("msg_2", { conversationId: "conv_1", senderPersonId: ANA, projectId: "proj_1", body: "Thanks, I'll tell Willow & Finch.", timestamp: "2026-10-13T10:00:00.000Z" }),
      r("msg_3", { conversationId: "conv_1", senderPersonId: BEN, projectId: "proj_1", body: "Also check the migration checklist.", timestamp: "2026-10-14T08:00:00.000Z" }),
      r("msg_4", { conversationId: "conv_1", senderPersonId: ANA, projectId: "proj_1", body: "Checklist is done.", timestamp: "2026-09-01T08:00:00.000Z" }),
      r("msg_5", { conversationId: "conv_2", senderPersonId: CY, body: "Private platform chatter.", timestamp: "2026-10-15T08:00:00.000Z" }),
    ],
    tools: [],
  };
}
