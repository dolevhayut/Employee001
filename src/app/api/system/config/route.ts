import { NextResponse } from "next/server";

// Returns *presence* of each required API key, never the value itself.
// Used by the UI to gate the Invite-employee flow on a fully configured
// install — otherwise the CEO promises a twin to an employee, the
// employee fills out a profile, and the twin can never actually answer
// or take action because no keys are wired up.

export const runtime = "nodejs";

export type SystemConfigStatus = {
  anthropic: boolean;
  composio: boolean;
  elevenLabs: boolean;
  /** True iff every *required* key is set. The UI uses this to flip the
   *  Invite button between active and disabled. */
  ready: boolean;
};

export async function GET() {
  const anthropic = Boolean(process.env.ANTHROPIC_API_KEY);
  const composio = Boolean(process.env.COMPOSIO_API_KEY);
  const elevenLabs = Boolean(process.env.ELEVENLABS_API_KEY);
  const ready = anthropic && composio;
  const body: SystemConfigStatus = { anthropic, composio, elevenLabs, ready };
  return NextResponse.json(body, {
    headers: { "Cache-Control": "no-store" },
  });
}
