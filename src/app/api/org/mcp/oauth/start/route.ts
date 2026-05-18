// POST /api/org/mcp/oauth/start
//
// Initiates the OAuth handshake for an MCP server that doesn't accept a
// Bearer token directly. Body shape mirrors the preset record minus the
// credentials part:
//
//   { name, description?, transport, url, iconSlug? }
//
// Response:
//
//   { authUrl, state }
//
// The caller opens `authUrl` in a popup. The user signs in with the upstream
// service, the auth server redirects back to our /callback route with
// ?code&state, the callback finishes the handshake and persists the
// resulting CustomMcpServer with `oauth: {...}` set.

import { NextRequest, NextResponse } from "next/server";
import {
  buildAuthUrl,
  discoverOAuth,
  pkcePair,
  randomState,
  registerClient,
} from "@/lib/mcp-oauth";
import { putPendingOAuth } from "@/lib/mcp-oauth-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function originFromRequest(req: NextRequest): string {
  // Honor the proxy if one is in front of us (next dev sets X-Forwarded-Host
  // when running behind the workspace runner), otherwise fall back to the
  // request URL.
  const proto = req.headers.get("x-forwarded-proto") ?? new URL(req.url).protocol.replace(":", "");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? new URL(req.url).host;
  return `${proto}://${host}`;
}

export async function POST(req: NextRequest) {
  let body: {
    name?: unknown;
    description?: unknown;
    transport?: unknown;
    url?: unknown;
    iconSlug?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const url = typeof body.url === "string" ? body.url.trim() : "";
  const transport = body.transport === "sse" ? "sse" : "http";
  const description =
    typeof body.description === "string" ? body.description.trim() : undefined;
  const iconSlug = typeof body.iconSlug === "string" ? body.iconSlug : undefined;

  if (!name || !url) {
    return NextResponse.json(
      { error: "name and url are required." },
      { status: 400 },
    );
  }

  try {
    const meta = await discoverOAuth(url);

    const origin = originFromRequest(req);
    const redirectUri = `${origin}/api/org/mcp/oauth/callback`;

    if (!meta.registrationEndpoint) {
      return NextResponse.json(
        {
          error:
            "Authorization server does not support Dynamic Client Registration. " +
            "Pre-registering an app per workspace isn't supported yet.",
        },
        { status: 501 },
      );
    }

    const client = await registerClient(meta.registrationEndpoint, redirectUri, "Employee001 workspace");
    const { verifier, challenge } = pkcePair();
    const state = randomState();
    const scope = (meta.scopesSupported ?? []).join(" ") || undefined;

    putPendingOAuth(state, {
      createdAt: Date.now(),
      serverName: name,
      serverDescription: description,
      mcpUrl: url,
      transport,
      iconSlug,
      authorizationServer: meta.authorizationServer,
      tokenEndpoint: meta.tokenEndpoint,
      clientId: client.clientId,
      clientSecret: client.clientSecret,
      codeVerifier: verifier,
      redirectUri,
      scope,
    });

    const authUrl = buildAuthUrl({
      authorizationEndpoint: meta.authorizationEndpoint,
      clientId: client.clientId,
      redirectUri,
      scope,
      state,
      codeChallenge: challenge,
    });

    return NextResponse.json({ authUrl, state });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
