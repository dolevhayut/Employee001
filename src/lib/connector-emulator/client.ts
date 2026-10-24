// A stand-in for the Composio client, for tests and evals only. getComposio()
// returns it when EMPLOYEE001_CONNECTORS=emulator, so everything above it runs
// unchanged: refreshConnections sees ACTIVE accounts, buildEmployeeMcpServer
// gets the captured tool contracts wrapped by the real ClaudeAgentSDKProvider,
// tools.execute answers from CompanySim, and webhook verification is the real
// SDK's (it is local HMAC; the SDK instance below never makes a request).

import fs from "fs";
import path from "path";
import { Composio } from "@composio/core";
import { ClaudeAgentSDKProvider } from "@composio/claude-agent-sdk";
import { HANDLERS, ToolError, toolkitOfSlug, type Ctx } from "./handlers";
import { indexWorld } from "./mapping";
import { UnsupportedQuery } from "./queries";
import { appendCallLog, appendOutbox, contractsDir, emulatedAccount, readOutbox } from "./state";
import { loadWorld } from "./world";
import { slackUserId } from "./ids";

/** Off unless asked for, and never in a production build (the shipped `start`). */
export function connectorEmulatorEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.EMPLOYEE001_CONNECTORS === "emulator" && env.NODE_ENV !== "production";
}

export type Contract = {
  slug: string;
  name: string;
  description: string;
  toolkit: string;
  version: string;
  inputParameters: { type: "object"; properties?: Record<string, { default?: unknown }>; required?: string[] };
  outputParameters?: unknown;
};

const contracts = new Map<string, Contract | null>();

export function loadContract(slug: string): Contract | null {
  if (!contracts.has(slug)) {
    try {
      contracts.set(slug, JSON.parse(fs.readFileSync(path.join(contractsDir(), `${slug}.json`), "utf8")) as Contract);
    } catch {
      contracts.set(slug, null);
    }
  }
  return contracts.get(slug) ?? null;
}

export type ToolExecuteResponse = { data: unknown; error: string | null; successful: boolean; logId?: string };

const employeeOf = (userId: string) => (userId.startsWith("employee:") ? userId.slice("employee:".length) : userId);
const fail = (error: string): ToolExecuteResponse => ({ data: {}, error, successful: false, logId: `log_emu_${Date.now().toString(36)}` });

/** composio.tools.execute, answered from CompanySim. */
export async function executeEmulated(slug: string, body: { userId: string; arguments?: Record<string, unknown> }): Promise<ToolExecuteResponse> {
  const employeeId = employeeOf(body.userId);
  const given = { ...(body.arguments ?? {}) };
  const log = (r: ToolExecuteResponse, unknownArguments?: string[]) => {
    appendCallLog({ at: new Date().toISOString(), employeeId, slug, arguments: given, successful: r.successful, ...(r.error ? { error: r.error } : {}), ...(unknownArguments?.length ? { unknownArguments } : {}) });
    return r;
  };
  const toolkit = toolkitOfSlug(slug);
  const account = emulatedAccount(employeeId);
  if (!account || !account.toolkits.includes(toolkit as never)) {
    return log(fail(`No connected account found for user ${body.userId} and toolkit ${toolkit}.`));
  }
  const contract = loadContract(slug);
  const handler = HANDLERS[slug];
  if (!contract || !handler) return log(fail(`Connector emulator: ${slug} is not emulated (see evals/connectors/README.md).`));

  const props = contract.inputParameters.properties ?? {};
  const unknown = Object.keys(given).filter((k) => !(k in props));
  const args: Record<string, unknown> = { ...given };
  for (const [k, p] of Object.entries(props)) if (args[k] === undefined && p.default !== undefined) args[k] = p.default;
  const missing = (contract.inputParameters.required ?? []).filter((k) => args[k] === undefined || args[k] === "");
  if (missing.length) return log(fail(`Missing required parameter(s): ${missing.join(", ")}`), unknown);

  let index;
  try {
    index = indexWorld(await loadWorld());
  } catch (err) {
    return log(fail(`Connector emulator: CompanySim unavailable (${err instanceof Error ? err.message : String(err)})`), unknown);
  }
  const me = index.people.get(account.personId);
  if (!me) return log(fail(`Connector emulator: no CompanySim person ${account.personId}`), unknown);

  const writes = readOutbox().filter((e) => e.slug === slug && e.personId === me.id).length;
  const ctx: Ctx = {
    index, me, now: Date.now(), writes,
    write: (written, result) => {
      appendOutbox({ id: `out_${Date.now().toString(36)}_${writes}`, at: new Date().toISOString(), employeeId, personId: me.id, toolkit, slug, arguments: written, result });
      return writes;
    },
  };
  try {
    const data = handler(args, ctx);
    return log({ data, error: null, successful: true, logId: `log_emu_${Date.now().toString(36)}` }, unknown);
  } catch (err) {
    if (err instanceof ToolError) return log(fail(err.message), unknown);
    if (err instanceof UnsupportedQuery) return log(fail(`Connector emulator: unsupported query (${err.message}). Real ${toolkit} may accept it.`), unknown);
    throw err;
  }
}

/** Contracts for the slugs a toolkit exposes, in captured form. */
export function contractsForToolkit(toolkit: string): Contract[] {
  return Object.keys(HANDLERS).filter((slug) => toolkitOfSlug(slug) === toolkit).map(loadContract).filter((c): c is Contract => Boolean(c));
}

let sdk: Composio | null = null;
/** The real SDK, only for verifyWebhook (local HMAC). No key, no tracking, no requests. */
function verifierSdk(): Composio {
  sdk ??= new Composio({ apiKey: "connector-emulator", baseURL: "http://127.0.0.1:9", allowTracking: false, disableVersionCheck: true });
  return sdk;
}

const notEmulated = (what: string) => async () => {
  throw new Error(`Connector emulator: ${what} is not emulated (OAuth and triggers need a real Composio account).`);
};

/** The parts of the Composio client E001 calls, shaped like the SDK's. */
export function emulatedComposio() {
  const provider = new ClaudeAgentSDKProvider();
  return {
    tools: {
      async get(userId: string, query: { toolkits?: string[]; tools?: string[] }) {
        const employeeId = employeeOf(userId);
        const account = emulatedAccount(employeeId);
        if (!account) return [];
        const wanted = query.tools?.length
          ? query.tools.map(loadContract).filter((c): c is Contract => Boolean(c))
          : (query.toolkits ?? []).filter((t) => account.toolkits.includes(t as never)).flatMap(contractsForToolkit);
        return provider.wrapTools(wanted as never, (slug: string, args: Record<string, unknown>) => executeEmulated(slug, { userId, arguments: args }) as never);
      },
      execute: (slug: string, body: { userId: string; arguments?: Record<string, unknown> }) => executeEmulated(slug, body),
    },
    connectedAccounts: {
      async list(query: { userIds?: string[] } = {}) {
        const accounts = (query.userIds ?? []).map((userId) => ({ userId, account: emulatedAccount(employeeOf(userId)) }));
        const team = accounts.some((a) => a.account?.toolkits.includes("slack")) ? indexWorld(await loadWorld()).slackTeamId : "";
        const items = accounts.flatMap(({ userId, account }) => {
          if (!account) return [];
          return account.toolkits.map((toolkit) => ({
            id: `ca_emu_${toolkit}_${employeeOf(userId)}`,
            status: "ACTIVE",
            toolkit: { slug: toolkit },
            authConfig: { id: `ac_emu_${toolkit}` },
            // The Slack identity real Composio reports for the connected user.
            metadata: toolkit === "slack" ? { user_id: slackUserId(account.personId), team_id: team } : {},
          }));
        });
        return { items, nextCursor: null };
      },
      async delete() { return {}; },
      link: notEmulated("connecting an account"),
    },
    authConfigs: {
      async list(query: { toolkit?: string } = {}) { return { items: query.toolkit ? [{ id: `ac_emu_${query.toolkit}` }] : [] }; },
      create: notEmulated("creating an auth config"),
    },
    triggers: {
      verifyWebhook: (params: Parameters<Composio["triggers"]["verifyWebhook"]>[0]) => verifierSdk().triggers.verifyWebhook(params),
      async listActive() { return { items: [] }; },
      async listTypes() { return { items: [] }; },
      create: notEmulated("creating a trigger"),
      async disable() { return {}; },
    },
    toolkits: { get: notEmulated("listing toolkits") },
  };
}
