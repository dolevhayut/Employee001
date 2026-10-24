// Snapshot the Composio tool contracts the emulator speaks: slug, description,
// input/output JSON schemas and version, exactly as the SDK hands them to
// ClaudeAgentSDKProvider. Also records each toolkit's "important" tool list
// (what buildEmployeeMcpServer asks for) so drift is visible.
//
// Needs COMPOSIO_API_KEY in the environment (never printed). Node 24:
//   node --env-file=<main checkout>/.env.local evals/connectors/capture-contracts.mjs
// then `npx vitest run src/lib/connector-emulator` to check the emulator still matches.
import fs from "node:fs";
import path from "node:path";
import { Composio } from "@composio/core";

const OUT = path.join(import.meta.dirname, "contracts");
const TOOLKITS = ["gmail", "outlook", "slack", "jira", "googledrive", "share_point", "microsoft_teams"];
/** Keep in sync with EMULATED_SLUGS in src/lib/connector-emulator/handlers.ts (a unit test checks). */
const EMULATED = [
  "GMAIL_FETCH_EMAILS", "GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID", "GMAIL_FETCH_MESSAGE_BY_THREAD_ID", "GMAIL_SEND_EMAIL", "GMAIL_REPLY_TO_THREAD", "GMAIL_CREATE_EMAIL_DRAFT", "GMAIL_WHO_AM_I",
  "OUTLOOK_QUERY_EMAILS", "OUTLOOK_LIST_MESSAGES", "OUTLOOK_SEND_EMAIL", "OUTLOOK_REPLY_EMAIL", "OUTLOOK_GET_PROFILE",
  "SLACK_SEARCH_MESSAGES", "SLACK_FETCH_CONVERSATION_HISTORY", "SLACK_FETCH_MESSAGE_THREAD_FROM_A_CONVERSATION", "SLACK_LIST_ALL_CHANNELS", "SLACK_LIST_ALL_USERS", "SLACK_SEND_MESSAGE", "SLACK_WHO_AM_I",
  "JIRA_SEARCH_FOR_ISSUES_USING_JQL_GET", "JIRA_GET_ISSUE", "JIRA_CREATE_ISSUE", "JIRA_ADD_COMMENT", "JIRA_GET_CURRENT_USER", "JIRA_GET_ALL_PROJECTS",
  "GOOGLEDRIVE_FIND_FILE", "GOOGLEDRIVE_DOWNLOAD_FILE",
  "SHARE_POINT_SEARCH_FILES",
  "MICROSOFT_TEAMS_TEAMS_LIST", "MICROSOFT_TEAMS_TEAMS_LIST_CHANNELS", "MICROSOFT_TEAMS_TEAMS_POST_CHANNEL_MESSAGE",
];
/** Slugs E001 source refers to by name: recorded so a rename shows up here. */
const REFERENCED = ["SLACK_LIST_CHANNELS", "SLACK_CHAT_POST_MESSAGE", "MICROSOFT_TEAMS_SEND_MESSAGE", "OUTLOOK_REPLY", "GOOGLEDRIVE_EXPORT_GOOGLE_WORKSPACE_FILE"];

if (!process.env.COMPOSIO_API_KEY) { console.error("COMPOSIO_API_KEY is not set"); process.exit(1); }
const composio = new Composio({ apiKey: process.env.COMPOSIO_API_KEY, allowTracking: false, disableVersionCheck: true });
const pick = (t) => ({ slug: t.slug, name: t.name, description: t.description, toolkit: t.toolkit?.slug, version: t.version, inputParameters: t.inputParameters, outputParameters: t.outputParameters });
const exists = async (slug) => { try { await composio.tools.getRawComposioToolBySlug(slug); return true; } catch { return false; } };

const index = {
  capturedAt: new Date().toISOString(),
  source: "composio.tools.getRawComposioTools / getRawComposioToolBySlug, @composio/core 0.8.0",
  inputSchemas: "verified (captured from Composio)",
  outputShapes: "unverified: Composio publishes only the {data, error, successful} wrapper; the emulator models data on the provider APIs (Gmail, Graph, Slack Web API, Jira REST v3, Drive v3) and on what E001 parses",
  emulated: EMULATED,
  toolkits: {},
  referencedByE001: {},
};
for (const toolkit of TOOLKITS) {
  const tools = await composio.tools.getRawComposioTools({ toolkits: [toolkit], important: true, limit: 50 });
  index.toolkits[toolkit] = tools.map((t) => t.slug);
}
fs.mkdirSync(OUT, { recursive: true });
for (const slug of EMULATED) {
  const t = pick(await composio.tools.getRawComposioToolBySlug(slug));
  fs.writeFileSync(path.join(OUT, `${slug}.json`), JSON.stringify(t, null, 2) + "\n");
}
for (const slug of REFERENCED) index.referencedByE001[slug] = (await exists(slug)) ? "exists" : "MISSING in Composio";
fs.writeFileSync(path.join(OUT, "index.json"), JSON.stringify(index, null, 2) + "\n");
console.log("saved", EMULATED.length, "contracts; referenced:", index.referencedByE001);
