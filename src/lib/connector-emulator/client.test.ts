import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { connectorEmulatorEnabled, emulatedComposio, executeEmulated } from "./client";
import { EMULATED_SLUGS } from "./handlers";
import { connectEmulatedEmployee, contractsDir, readCallLog, readOutbox } from "./state";
import { setWorldForTests } from "./world";
import { slackUserId } from "./ids";
import { ANA, CY, testWorld } from "./test-world";

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "e001-emulator-test-"));
const before = { home: process.env.EMPLOYEE001_HOME, mode: process.env.EMPLOYEE001_CONNECTORS };
process.env.EMPLOYEE001_HOME = HOME;
afterAll(() => {
  process.env.EMPLOYEE001_HOME = before.home;
  process.env.EMPLOYEE001_CONNECTORS = before.mode;
  setWorldForTests(null);
  fs.rmSync(HOME, { recursive: true, force: true });
});

const run = (slug: string, args: Record<string, unknown> = {}, employee = "ana") => executeEmulated(slug, { userId: `employee:${employee}`, arguments: args });

beforeEach(() => {
  fs.rmSync(path.join(HOME, "data"), { recursive: true, force: true });
  setWorldForTests(testWorld(Date.now()));
  connectEmulatedEmployee("ana", ANA, ["gmail", "outlook", "slack", "jira", "googledrive", "share_point", "microsoft_teams"]);
  connectEmulatedEmployee("cy", CY, ["slack"]);
});

describe("connector emulator: switch and contracts", () => {
  it("is off by default and never on in a production build", () => {
    expect(connectorEmulatorEnabled({})).toBe(false);
    expect(connectorEmulatorEnabled({ EMPLOYEE001_CONNECTORS: "emulator", NODE_ENV: "production" })).toBe(false);
    expect(connectorEmulatorEnabled({ EMPLOYEE001_CONNECTORS: "emulator", NODE_ENV: "test" })).toBe(true);
    expect(connectorEmulatorEnabled({ EMPLOYEE001_CONNECTORS: "composio", NODE_ENV: "test" })).toBe(false);
  });

  it("has a captured contract for every emulated slug, and nothing extra", () => {
    const files = fs.readdirSync(contractsDir()).filter((f) => f.endsWith(".json") && f !== "index.json").map((f) => f.replace(/\.json$/, "")).sort();
    expect(files).toEqual(EMULATED_SLUGS);
    const index = JSON.parse(fs.readFileSync(path.join(contractsDir(), "index.json"), "utf8")) as { emulated: string[] };
    expect([...index.emulated].sort()).toEqual(EMULATED_SLUGS);
    const script = fs.readFileSync(path.join(contractsDir(), "..", "capture-contracts.mjs"), "utf8");
    for (const slug of EMULATED_SLUGS) expect(script).toContain(`"${slug}"`);
  });

  it("reports the configured toolkits as ACTIVE connected accounts, with the Slack identity", async () => {
    const { items } = await emulatedComposio().connectedAccounts.list({ userIds: ["employee:cy", "employee:nobody"] });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ status: "ACTIVE", toolkit: { slug: "slack" }, metadata: { user_id: slackUserId(CY) } });
  });

  it("wraps the contracts of connected toolkits only, as Agent SDK tools", async () => {
    const tools = (await emulatedComposio().tools.get("employee:cy", { toolkits: ["slack", "gmail"] })) as unknown as { name: string }[];
    expect(tools.map((t) => t.name)).toContain("SLACK_SEND_MESSAGE");
    expect(tools.some((t) => t.name.startsWith("GMAIL_"))).toBe(false);
  });
});

describe("connector emulator: tool execution", () => {
  it("refuses toolkits the employee didn't connect, like Composio", async () => {
    const r = await run("GMAIL_FETCH_EMAILS", {}, "cy");
    expect(r.successful).toBe(false);
    expect(r.error).toMatch(/No connected account/);
  });

  it("applies contract defaults (Gmail returns one message unless asked for more)", async () => {
    const one = await run("GMAIL_FETCH_EMAILS");
    expect(one.successful).toBe(true);
    expect((one.data as { messages: unknown[] }).messages).toHaveLength(1);
    const unread = await run("GMAIL_FETCH_EMAILS", { query: "is:unread", max_results: 50 });
    const messages = (unread.data as { messages: { subject: string; labelIds: string[]; messageText: string }[] }).messages;
    expect(messages.length).toBeGreaterThan(0);
    expect(messages.every((m) => m.labelIds.includes("UNREAD") && m.messageText)).toBe(true);
  });

  it("checks required parameters and logs arguments the contract doesn't define", async () => {
    expect((await run("SLACK_FETCH_MESSAGE_THREAD_FROM_A_CONVERSATION", { channel_id: "C1", thread_ts: "1.2" })).error).toMatch(/Missing required parameter\(s\): channel, ts/);
    expect(readCallLog().at(-1)?.unknownArguments).toEqual(["channel_id", "thread_ts"]);
  });

  it("sends Slack messages to the outbox only, as the connected user", async () => {
    const channel = (await run("SLACK_LIST_ALL_CHANNELS", { limit: 10 })).data as { channels: { id: string; name: string }[] };
    const cs = channel.channels.find((c) => c.name === "customer-success")!;
    const r = await run("SLACK_SEND_MESSAGE", { channel: cs.id, markdown_text: "Cutover is Friday." });
    expect(r).toMatchObject({ successful: true, data: { ok: true, channel: cs.id, message: { user: slackUserId(ANA), text: "Cutover is Friday." } } });
    expect(readOutbox()).toMatchObject([{ slug: "SLACK_SEND_MESSAGE", employeeId: "ana", personId: ANA, toolkit: "slack", arguments: { markdown_text: "Cutover is Friday." } }]);
  });

  it("keeps private channels private", async () => {
    const r = await run("SLACK_SEARCH_MESSAGES", { query: "chatter", count: 10 });
    expect((r.data as { messages: { total: number } }).messages.total).toBe(0);
    expect((await run("SLACK_SEARCH_MESSAGES", { query: "chatter", count: 10 }, "cy")).data).toMatchObject({ messages: { total: 1 } });
  });

  it("replies on a Gmail thread from the mailbox, refuses unknown threads", async () => {
    expect((await run("GMAIL_REPLY_TO_THREAD", { thread_id: "nope", message_body: "hi" })).error).toMatch(/not found/);
    const inbox = (await run("GMAIL_FETCH_EMAILS", { query: "in:inbox", max_results: 1 })).data as { messages: { threadId: string; sender: string }[] };
    const r = await run("GMAIL_REPLY_TO_THREAD", { thread_id: inbox.messages[0].threadId, message_body: "On it." });
    expect(r.successful).toBe(true);
    expect(readOutbox()[0].arguments).toMatchObject({ message_body: "On it.", resolved_recipients: [expect.stringMatching(/@willow-finch\.test$/)] });
  });

  it("answers Outlook, Jira, Drive, SharePoint and Teams from the same company", async () => {
    const outlook = (await run("OUTLOOK_QUERY_EMAILS", { filter: "isRead eq false", top: 50 })).data as { value: { isRead: boolean }[] };
    expect(outlook.value.length).toBeGreaterThan(0);
    expect(outlook.value.every((m) => !m.isRead)).toBe(true);
    const jira = (await run("JIRA_SEARCH_FOR_ISSUES_USING_JQL_GET", { jql: "assignee = currentUser() AND statusCategory != Done ORDER BY created ASC" })).data as { issues: { key: string }[] };
    expect(jira.issues.map((i) => i.key)).toEqual(["AM-3", "AM-4", "AM-5"]);
    const files = (await run("GOOGLEDRIVE_FIND_FILE", { q: "name contains 'atlas'" })).data as { files: { id: string }[] };
    const dl = (await run("GOOGLEDRIVE_DOWNLOAD_FILE", { fileId: files.files[0].id })).data as { downloaded_file_content: { s3url: string } };
    expect(await (await fetch(dl.downloaded_file_content.s3url)).text()).toMatch(/cutover risks/);
    const sp = (await run("SHARE_POINT_SEARCH_FILES", { query: "cutover" })).data as { PrimaryQueryResult: { RelevantResults: { RowCount: number } } };
    expect(sp.PrimaryQueryResult.RelevantResults.RowCount).toBe(1);
    const teams = (await run("MICROSOFT_TEAMS_TEAMS_LIST")).data as { value: { id: string; displayName: string }[] };
    const team = teams.value.find((t) => t.displayName === "Customer Success")!;
    const channels = (await run("MICROSOFT_TEAMS_TEAMS_LIST_CHANNELS", { team_id: team.id })).data as { value: { id: string }[] };
    const post = await run("MICROSOFT_TEAMS_TEAMS_POST_CHANNEL_MESSAGE", { team_id: team.id, channel_id: channels.value[0].id, content: "Hello" });
    expect(post.successful).toBe(true);
    expect(readOutbox().map((e) => e.slug)).toEqual(["MICROSOFT_TEAMS_TEAMS_POST_CHANNEL_MESSAGE"]);
  });

  it("says when a query is outside what it can answer", async () => {
    const r = await run("JIRA_SEARCH_FOR_ISSUES_USING_JQL_GET", { jql: "sprint in openSprints()" });
    expect(r.successful).toBe(false);
    expect(r.error).toMatch(/unsupported query/);
  });
});

describe("AI disclosure against the captured contracts", () => {
  // The field each send tool's captured input schema carries the message in.
  const MESSAGE_FIELD: Record<string, string> = {
    GMAIL_SEND_EMAIL: "body",
    GMAIL_REPLY_TO_THREAD: "message_body",
    GMAIL_CREATE_EMAIL_DRAFT: "body",
    OUTLOOK_SEND_EMAIL: "body",
    SLACK_SEND_MESSAGE: "markdown_text",
    OUTLOOK_REPLY_EMAIL: "comment",
    MICROSOFT_TEAMS_TEAMS_POST_CHANNEL_MESSAGE: "content",
  };
  const check = async (slug: string, field: string) => {
    const { discloseOutbound, disclosureLine } = await import("@/lib/ai-disclosure");
    const { loadContract } = await import("./client");
    expect(Object.keys(loadContract(slug)?.inputParameters.properties ?? {})).toContain(field);
    const out = discloseOutbound(`mcp__composio__${slug}`, { [field]: "Hello" }, "Ana Lee");
    expect(String(out[field])).toMatch(new RegExp(`^${disclosureLine("Ana Lee")}`));
  };
  for (const [slug, field] of Object.entries(MESSAGE_FIELD)) it(`${slug} discloses in "${field}"`, () => check(slug, field));
  it("every captured send contract is recognised as a send", async () => {
    const { isOutboundMessageTool } = await import("@/lib/ai-disclosure");
    const fs = await import("node:fs");
    const { contractsDir } = await import("./state");
    const sends = fs.readdirSync(contractsDir()).filter((f) => /(?:SEND|REPLY|POST|DRAFT)/.test(f)).map((f) => f.replace(/\.json$/, ""));
    expect(sends.length).toBeGreaterThan(0);
    for (const slug of sends) expect(isOutboundMessageTool(slug), slug).toBe(true);
  });
});
