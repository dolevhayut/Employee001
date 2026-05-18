// GET /api/org/mcp/oauth/callback?code=…&state=…
//
// Finishes the handshake started by /api/org/mcp/oauth/start. Reads the
// pending flow keyed by `state`, exchanges the code for tokens, persists
// the resulting CustomMcpServer with `oauth: {...}` populated, and returns
// a tiny HTML page that postMessages success to the opener window and
// auto-closes.
//
// The opener (the Settings page) listens on `window.message` for a
// `{ type: "mcp-oauth", ok }` payload and refreshes the server list.

import { NextRequest } from "next/server";
import { exchangeCode } from "@/lib/mcp-oauth";
import { takePendingOAuth } from "@/lib/mcp-oauth-state";
import { createCustomMcp } from "@/lib/custom-mcp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function respond(status: number, payload: { ok: boolean; message: string }): Response {
  // We always return HTML — the response is rendered inside the popup
  // window, so JSON would just look like a wall of text to the user.
  const body = `<!doctype html>
<html><head><meta charset="utf-8"><title>Connecting…</title></head>
<body style="font-family: ui-sans-serif, system-ui; background:#f3eee8; color:#161311; display:grid; place-items:center; height:100vh; margin:0;">
  <div style="text-align:center; max-width: 460px; padding: 24px;">
    <div style="font-size: 22px; font-weight: 600; margin-bottom: 12px;">${
      payload.ok ? "Connected" : "Connection failed"
    }</div>
    <div style="font-size: 14px; color:#6b6258; line-height: 1.5;">${escapeHtml(payload.message)}</div>
    <div style="margin-top: 24px; font-size: 12px; color:#9a9085;">This window will close automatically.</div>
  </div>
  <script>
    try {
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage({ type: "mcp-oauth", ok: ${payload.ok ? "true" : "false"}, message: ${JSON.stringify(payload.message)} }, "*");
      }
    } catch (_) {}
    setTimeout(() => { try { window.close(); } catch (_) {} }, ${payload.ok ? 600 : 4000});
  </script>
</body></html>`;
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function GET(req: NextRequest) {
  const u = new URL(req.url);
  const code = u.searchParams.get("code");
  const state = u.searchParams.get("state");
  const errorParam = u.searchParams.get("error");
  const errorDescription = u.searchParams.get("error_description");

  if (errorParam) {
    return respond(400, {
      ok: false,
      message: errorDescription ?? errorParam,
    });
  }
  if (!code || !state) {
    return respond(400, {
      ok: false,
      message: "Missing code or state in callback URL.",
    });
  }

  const flow = takePendingOAuth(state);
  if (!flow) {
    return respond(400, {
      ok: false,
      message:
        "This OAuth flow has expired or wasn't started by this workspace. Try clicking Connect again.",
    });
  }

  try {
    const tokens = await exchangeCode({
      tokenEndpoint: flow.tokenEndpoint,
      code,
      codeVerifier: flow.codeVerifier,
      clientId: flow.clientId,
      clientSecret: flow.clientSecret,
      redirectUri: flow.redirectUri,
    });

    await createCustomMcp({
      name: flow.serverName,
      description: flow.serverDescription,
      transport: flow.transport,
      url: flow.mcpUrl,
      headers: [],
      enabled: true,
      oauth: {
        authorizationServer: flow.authorizationServer,
        tokenEndpoint: flow.tokenEndpoint,
        clientId: flow.clientId,
        clientSecret: flow.clientSecret,
        scope: tokens.scope ?? flow.scope,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
      },
    });

    return respond(200, {
      ok: true,
      message: `${flow.serverName} is now available to every twin in this workspace.`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return respond(400, { ok: false, message });
  }
}
