import { describe, expect, it } from "vitest";
import { indexWorld, mailboxFor, readableChannels, visibleFiles } from "./mapping";
import { slackUserId } from "./ids";
import { ANA, BEN, CY, testWorld } from "./test-world";

const NOW = Date.parse("2026-10-20T12:00:00Z");

describe("connector emulator data mapping", () => {
  it("is deterministic: the same world gives the same ids", () => {
    const a = indexWorld(testWorld(NOW), NOW);
    const b = indexWorld(testWorld(NOW), NOW);
    expect(a.mail.map((m) => m.id)).toEqual(b.mail.map((m) => m.id));
    expect(a.slackMessages.map((m) => m.ts)).toEqual(b.slackMessages.map((m) => m.ts));
    expect(a.issues.map((i) => i.key)).toEqual(b.issues.map((i) => i.key));
    expect(new Set(a.mail.map((m) => m.id)).size).toBe(a.mail.length);
  });

  it("derives one email thread per ticket, shaped by its status", () => {
    const ix = indexWorld(testWorld(NOW), NOW);
    const threadOf = (ticket: string) => mailboxFor(ix, ANA).filter((m) => m.source.id === ticket).reverse();
    const open = threadOf("t_open");
    expect(open).toHaveLength(1);
    expect(open[0].from.email).toMatch(/@willow-finch\.test$/);
    expect(open[0].labels).toEqual(expect.arrayContaining(["INBOX", "UNREAD"]));
    const waiting = threadOf("t_wait");
    expect(waiting.at(-1)!.from.personId).toBe(ANA);
    expect(waiting.at(-1)!.labels).toContain("SENT");
    const progress = threadOf("t_prog");
    expect(progress).toHaveLength(3);
    expect(progress.at(-1)!.body).toMatch(/Any update/);
    expect(progress.at(-1)!.labels).toContain("UNREAD");
    expect(progress.map((m) => m.at)).toEqual([...progress.map((m) => m.at)].sort((x, y) => x - y));
    expect(threadOf("t_res").at(-1)!.body).toMatch(/resolved/);
    expect(new Set(progress.map((m) => m.threadId)).size).toBe(1);
  });

  it("copies the account owner, and keeps mail to the people on it", () => {
    const ix = indexWorld(testWorld(NOW), NOW);
    const ben = mailboxFor(ix, BEN);
    expect(ben.some((m) => m.source.id === "t_open" && m.labels.includes("INBOX"))).toBe(true);
    // Renewal in 20 days: the contact wrote 45 days before it.
    expect(ben.some((m) => m.source.kind === "renewal")).toBe(true);
    // Ana mailed her project document to the project owner.
    const share = ben.find((m) => m.source.kind === "document");
    expect(share?.from.personId).toBe(ANA);
    expect(mailboxFor(ix, ANA).find((m) => m.source.kind === "document")?.labels).toEqual(["SENT"]);
    expect(mailboxFor(ix, CY)).toEqual([]);
  });

  it("maps channels, membership and threads for Slack", () => {
    const ix = indexWorld(testWorld(NOW), NOW);
    expect(readableChannels(ix, ANA).map((c) => c.name)).toEqual(["customer-success"]);
    expect(readableChannels(ix, CY).map((c) => c.name).sort()).toEqual(["customer-success", "platform-private"]);
    const cs = ix.channels.find((c) => c.name === "customer-success")!;
    expect([...cs.members].sort()).toEqual([ANA, BEN].sort());
    const thread = ix.slackMessages.find((m) => m.text.startsWith("Atlas: cutover"))!;
    expect(thread.user).toBe(slackUserId(BEN));
    expect(thread.replies.map((r) => r.text)).toEqual(["Thanks, I'll tell Willow & Finch.", "Also check the migration checklist."]);
    expect(thread.replies.every((r) => r.threadTs === thread.ts)).toBe(true);
    expect(ix.slackMessages.find((m) => m.text === "Checklist is done.")!.replies).toEqual([]);
  });

  it("maps tickets to Jira issues numbered by creation within a project", () => {
    const ix = indexWorld(testWorld(NOW), NOW);
    expect(ix.jiraProjects.map((p) => p.key)).toEqual(["AM"]);
    const byTicket = Object.fromEntries(ix.issues.map((i) => [i.csId, i]));
    expect(byTicket.t_closed.key).toBe("AM-1");
    expect(byTicket.t_open.key).toBe("AM-5");
    expect(byTicket.t_prog.status).toBe("In Progress");
    expect(byTicket.t_wait.status).toBe("Waiting for customer");
    expect(byTicket.t_res.statusCategory).toBe("done");
    expect(byTicket.t_open.priority).toBe("High");
  });

  it("shows company documents to everyone and private ones to their author only", () => {
    const ix = indexWorld(testWorld(NOW), NOW);
    expect(visibleFiles(ix, ANA).map((f) => f.title)).toEqual(["Atlas Migration · Delivery plan"]);
    expect(visibleFiles(ix, CY).map((f) => f.title).sort()).toEqual(["Atlas Migration · Delivery plan", "Platform notes"]);
  });

  it("maps teams to Microsoft Teams with General plus the team's channels", () => {
    const ix = indexWorld(testWorld(NOW), NOW);
    const cs = ix.teams.find((t) => t.name === "Customer Success")!;
    expect(cs.channels.map((c) => c.name)).toEqual(["General", "customer-success"]);
    expect(cs.members.has(ANA)).toBe(true);
    expect(cs.members.has(CY)).toBe(false);
  });
});
