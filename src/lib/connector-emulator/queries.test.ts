import { describe, expect, it } from "vitest";
import { UnsupportedQuery, driveQuery, gmailQuery, jqlQuery, kqlQuery, odataFilter, slackQuery } from "./queries";

const NOW = Date.parse("2026-10-20T12:00:00Z");
const DAY = 86_400_000;

describe("connector emulator query languages", () => {
  const mail = (over: Partial<Parameters<ReturnType<typeof gmailQuery>>[0]> = {}) => ({
    from: "Sam Park <sam.park@willow-finch.test>", to: "Ana Lee <ana.lee@acme-labs.test>", cc: "", subject: "Rollout question",
    body: "Can you confirm the cutover date?", labels: ["INBOX", "UNREAD"], at: NOW - DAY, ...over,
  });

  it("Gmail search: operators, OR, negation, dates", () => {
    expect(gmailQuery("from:willow-finch is:unread")(mail())).toBe(true);
    expect(gmailQuery("in:sent")(mail())).toBe(false);
    expect(gmailQuery("subject:rollout -cutover")(mail())).toBe(false);
    expect(gmailQuery("from:nobody OR subject:\"rollout question\"")(mail())).toBe(true);
    expect(gmailQuery("in:inbox newer_than:2d", NOW)(mail())).toBe(true);
    expect(gmailQuery("in:inbox newer_than:2d", NOW)(mail({ at: NOW - 3 * DAY }))).toBe(false);
    expect(gmailQuery(`in:inbox after:${Math.floor((NOW - 2 * DAY) / 1000)}`)(mail())).toBe(true);
    expect(gmailQuery("after:2026/10/25")(mail())).toBe(false);
    expect(gmailQuery("cutover")(mail())).toBe(true);
    expect(gmailQuery("")(mail())).toBe(true);
  });

  it("Slack search: in:, from:, mentions, dates", () => {
    const m = { text: "<@U1> Atlas cutover moved", user: "U2", userName: "Ben Ortiz", channelId: "C1", channelName: "customer-success", at: Date.parse("2026-10-13T09:00:00Z") };
    expect(slackQuery("cutover in:#customer-success")(m)).toBe(true);
    expect(slackQuery("from:<@U2>")(m)).toBe(true);
    expect(slackQuery("from:@ben.ortiz")(m)).toBe(true);
    expect(slackQuery("<@U1>")(m)).toBe(true);
    expect(slackQuery("<@U9>")(m)).toBe(false);
    expect(slackQuery("after:2026-10-12 before:2026-10-14")(m)).toBe(true);
    expect(slackQuery("in:general")(m)).toBe(false);
  });

  it("Graph $filter: comparisons, functions, and/or; unsupported clauses throw", () => {
    const msg = { isRead: false, subject: "Rollout question", receivedDateTime: "2026-10-19T12:00:00Z", from: { emailAddress: { address: "sam.park@willow-finch.test" } } };
    expect(odataFilter("isRead eq false and receivedDateTime ge 2026-10-01T00:00:00Z")(msg)).toBe(true);
    expect(odataFilter("contains(subject,'rollout') or isRead eq true")(msg)).toBe(true);
    expect(odataFilter("from/emailAddress/address eq 'SAM.PARK@willow-finch.test'")(msg)).toBe(true);
    expect(odataFilter("receivedDateTime lt 2026-10-01T00:00:00Z")(msg)).toBe(false);
    expect(() => odataFilter("toRecipients/any(r:r/emailAddress/address eq 'x')")).toThrow(UnsupportedQuery);
  });

  it("JQL: assignee, status, text, relative dates, ORDER BY", () => {
    const me = { accountId: "acc-ana", email: "ana.lee@acme-labs.test", name: "Ana Lee" };
    const issue = { key: "AM-2", projectKey: "AM", projectName: "Atlas Migration", summary: "Rollout question", description: "validating the rollout", status: "In Progress", statusCategory: "indeterminate", priority: "High", labels: ["willow-finch"], type: "Task", created: NOW - 10 * DAY, updated: NOW - 2 * DAY, assignee: me };
    const q = jqlQuery("assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC", me, NOW);
    expect(q.match(issue)).toBe(true);
    expect(q.order).toEqual([{ field: "updated", dir: "desc" }]);
    expect(jqlQuery('project in (AM, XYZ) and text ~ "rollout"', me, NOW).match(issue)).toBe(true);
    expect(jqlQuery("updated >= -7d", me, NOW).match(issue)).toBe(true);
    expect(jqlQuery("created >= -7d", me, NOW).match(issue)).toBe(false);
    expect(jqlQuery('status in ("To Do", Done)', me, NOW).match(issue)).toBe(false);
    expect(jqlQuery('assignee = "ana.lee@acme-labs.test" AND resolution = EMPTY', me, NOW).match(issue)).toBe(true);
    expect(jqlQuery("(assignee = currentUser() OR reporter = currentUser()) AND updated >= -360d", me, NOW).match(issue)).toBe(true);
    expect(jqlQuery("reporter is EMPTY", me, NOW).match(issue)).toBe(true);
    expect(() => jqlQuery("sprint in openSprints()", me, NOW)).toThrow(UnsupportedQuery);
  });

  it("Drive q: name/fullText/owners/dates with and, or, not and parentheses", () => {
    const f = { name: "Atlas Migration · Delivery plan.md", body: "cutover risks", mimeType: "text/markdown", owners: ["ana.lee@acme-labs.test"], parents: ["0Aroot"], modified: Date.parse("2026-10-12T00:00:00Z"), created: 0, mine: true };
    expect(driveQuery("name contains 'atlas' and trashed = false")(f)).toBe(true);
    expect(driveQuery("(fullText contains 'cutover' or name contains 'x') and 'me' in owners")(f)).toBe(true);
    expect(driveQuery("not name contains 'atlas'")(f)).toBe(false);
    expect(driveQuery("modifiedTime > '2026-10-01T00:00:00'")(f)).toBe(true);
    expect(driveQuery("mimeType = 'application/vnd.google-apps.document'")(f)).toBe(false);
    expect(() => driveQuery("properties has { key='x' }")).toThrow(UnsupportedQuery);
  });

  it("SharePoint KQL: terms, properties, OR", () => {
    const d = { title: "Atlas Migration · Delivery plan", body: "cutover risks", author: "Ana Lee", extension: "md", path: "https://x/Shared Documents/a.md" };
    expect(kqlQuery("atlas cutover")(d)).toBe(true);
    expect(kqlQuery("author:\"Ana Lee\" filetype:md")(d)).toBe(true);
    expect(kqlQuery("nothing OR delivery")(d)).toBe(true);
    expect(kqlQuery("atlas -cutover")(d)).toBe(false);
  });
});
