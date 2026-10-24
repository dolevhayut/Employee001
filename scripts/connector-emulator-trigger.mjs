#!/usr/bin/env node
// Post a signed Composio trigger delivery ("new email" / "new Slack message")
// to a running Employee001, as Composio would. For the connector emulator
// (evals/connectors/README.md); needs Node 24 (loads the TypeScript helper
// with type stripping) and the server's COMPOSIO_WEBHOOK_SECRET.
//
//   COMPOSIO_WEBHOOK_SECRET=... node scripts/connector-emulator-trigger.mjs email \
//     --employee <id> --from "Sam Park <sam.park@willow-finch.test>" --to me@acme-labs.test \
//     --subject "Question about the rollout" --body "Can you confirm the cutover date?"
//   COMPOSIO_WEBHOOK_SECRET=... node scripts/connector-emulator-trigger.mjs slack \
//     --employee <id> --person <companysim person id> --channel C123 --from-person <person id> --text "Can you check this?"
//
// --url defaults to http://localhost:3001. Slack ids are derived from CompanySim
// person ids exactly as the emulator derives them.
import { parseArgs } from "node:util";
import { emailTrigger, signDelivery, slackTrigger, EMAIL_ROUTE, SLACK_ROUTE } from "../src/lib/connector-emulator/webhook.ts";
import { slackTeamId, slackUserId } from "../src/lib/connector-emulator/ids.ts";

const [kind, ...rest] = process.argv.slice(2);
const { values } = parseArgs({
  args: rest,
  options: {
    url: { type: "string", default: "http://localhost:3001" },
    employee: { type: "string" },
    from: { type: "string" }, to: { type: "string", default: "" }, subject: { type: "string" }, body: { type: "string" }, thread: { type: "string" },
    person: { type: "string" }, "from-person": { type: "string" }, channel: { type: "string" }, text: { type: "string" }, dm: { type: "boolean", default: false },
    domain: { type: "string", default: "acme-labs.test" },
    "dry-run": { type: "boolean", default: false },
  },
});
const secret = process.env.COMPOSIO_WEBHOOK_SECRET;
if (!secret || !values.employee || !["email", "slack"].includes(kind)) {
  console.error("usage: COMPOSIO_WEBHOOK_SECRET=... node scripts/connector-emulator-trigger.mjs <email|slack> --employee <id> [options]");
  process.exit(2);
}
let event, route;
if (kind === "email") {
  if (!values.from || !values.subject || !values.body) { console.error("email needs --from, --subject, --body"); process.exit(2); }
  event = emailTrigger(values.employee, { from: values.from, to: values.to, subject: values.subject, body: values.body, threadId: values.thread });
  route = EMAIL_ROUTE;
} else {
  if (!values.person || !values["from-person"] || !values.channel || !values.text) { console.error("slack needs --person, --from-person, --channel, --text"); process.exit(2); }
  const text = values.dm ? values.text : `<@${slackUserId(values.person)}> ${values.text}`;
  event = slackTrigger(values.employee, { channel: values.channel, user: slackUserId(values["from-person"]), text, team: slackTeamId(values.domain), channelType: values.dm ? "im" : "channel" });
  route = SLACK_ROUTE;
}
const delivery = signDelivery(JSON.stringify(event), secret);
if (values["dry-run"]) { console.log(JSON.stringify({ route, headers: delivery.headers, body: event }, null, 2)); process.exit(0); }
const res = await fetch(new URL(route, values.url), { method: "POST", headers: delivery.headers, body: delivery.body });
console.log(res.status, await res.text());
process.exit(res.ok ? 0 : 1);
