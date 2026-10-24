import { canRunModel, currentProvider, providerLabel } from "@/lib/model-provider";
import { claudeCliStatus } from "@/lib/claude-code-cli";

export const runtime = "nodejs";

/** Configuration is intentionally read-only in the UI; setup owns `.env`.
 *  In claude-code mode it also reports the user's Claude Code sign-in. */
export async function GET() {
  const provider = currentProvider();
  if (provider !== "claude-code") return Response.json({ provider, label: providerLabel(provider) });
  const cli = await claudeCliStatus();
  const model = canRunModel();
  return Response.json({
    provider,
    label: providerLabel(provider),
    claudeCode: { version: cli.version, loggedIn: cli.loggedIn, subscriptionType: cli.subscriptionType },
    ...(model.ok ? {} : { problem: model.reason }),
  });
}
