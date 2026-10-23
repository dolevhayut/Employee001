const NOT_RUNNING_MESSAGE = "Employee001 is not running. Start it with: npx employee001 start";

function hasRequestId(message) {
  return Object.prototype.hasOwnProperty.call(message, "id");
}

function writeJson(write, value) {
  write(`${JSON.stringify(value)}\n`);
}

// Returns true when at least one JSON-RPC message was written.
async function forwardResponse(response, write) {
  const contentType = response.headers.get("content-type") ?? "";
  const body = await response.text();
  let wrote = false;
  const emit = (value) => {
    writeJson(write, value);
    wrote = true;
  };

  if (contentType.toLowerCase().includes("text/event-stream")) {
    for (const line of body.split(/\r?\n/)) {
      if (line.startsWith("data:")) {
        try {
          emit(JSON.parse(line.slice(5).trimStart()));
        } catch {
          // MCP clients require stdout to be newline-delimited JSON-RPC only.
        }
      }
    }
    return wrote;
  }

  try {
    const payload = JSON.parse(body);
    for (const message of Array.isArray(payload) ? payload : [payload]) {
      // The app's auth gate answers with plain JSON ({ error, reason }); only
      // JSON-RPC may reach the client.
      if (message?.jsonrpc === "2.0") emit(message);
    }
  } catch {
    // A malformed upstream response must not corrupt the client's stdio stream.
  }
  return wrote;
}

function firstSet(...values) {
  // Empty strings and unexpanded "${VAR}" placeholders count as unset: MCP
  // clients pass either when a configured variable has no value.
  return values.find(
    (value) => typeof value === "string" && value.trim() !== "" && !/^\$\{[^}]*\}$/.test(value.trim()),
  );
}

/**
 * Where the bridge connects and with which token. Flags win, then the
 * environment the MCP client passes (a plugin or editor config), then the
 * `.env` in the current directory (running from the Employee001 install).
 *
 * The `.env` sits in whatever folder the client was started in, which can be
 * any repository. So its URL is used only together with its own token: a
 * token from a flag or the client's environment is never sent to a URL that
 * a project's `.env` chose.
 * @param {{ url?: string, token?: string, processEnv?: Record<string, string | undefined>, fileEnv?: Record<string, string | undefined> }} options
 */
export function resolveBridgeConfig({ url, token, processEnv = {}, fileEnv = {} }) {
  const port = firstSet(fileEnv.PORT) ?? "3000";
  const trustedToken = firstSet(token, processEnv.EMPLOYEE001_MCP_TOKEN, processEnv.EMPLOYEE001_TOKEN);
  const fileToken = firstSet(fileEnv.EMPLOYEE001_MCP_TOKEN, fileEnv.EMPLOYEE001_TOKEN);
  const trustedUrl = firstSet(url, processEnv.EMPLOYEE001_MCP_URL);
  const fileUrl = trustedToken ? undefined : firstSet(fileEnv.EMPLOYEE001_MCP_URL);
  return {
    url: trustedUrl ?? fileUrl ?? `http://127.0.0.1:${port}/api/mcp`,
    token: trustedToken ?? fileToken,
  };
}

/**
 * Forward newline-delimited JSON-RPC between an MCP stdio client and Employee001.
 */
export function createBridge({ url, token, fetchImpl = fetch, write, log }) {
  let loggedNotRunning = false;

  return {
    async handleLine(line) {
      if (!line.trim()) return;

      let message;
      try {
        message = JSON.parse(line);
      } catch {
        log("Ignoring invalid JSON-RPC input.");
        return;
      }

      try {
        const response = await fetchImpl(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json, text/event-stream",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(message),
        });
        const wrote = await forwardResponse(response, write);
        // An app without /api/mcp (older version) answers with an HTML 404;
        // without a reply the client would wait forever.
        if (!wrote && hasRequestId(message) && response.status !== 202) {
          writeJson(write, {
            jsonrpc: "2.0",
            id: message.id,
            error:
              response.status === 401
                ? {
                    code: -32004,
                    message: `Employee001 at ${url} refused the request: missing or invalid token. Set EMPLOYEE001_MCP_TOKEN in the MCP client's env (or pass --token) to the instance's EMPLOYEE001_MCP_TOKEN or EMPLOYEE001_TOKEN.`,
                  }
                : response.status === 403
                  ? { code: -32003, message: `Employee001 at ${url} refused the request (HTTP 403).` }
                  : {
                      code: -32002,
                      message: `Employee001 at ${url} has no usable MCP endpoint (HTTP ${response.status}). Update with: npx employee001@latest start`,
                    },
          });
        }
      } catch {
        if (!hasRequestId(message)) return;

        const error = {
          jsonrpc: "2.0",
          id: message.id,
          error: { code: -32002, message: NOT_RUNNING_MESSAGE },
        };
        writeJson(write, error);
        if (!loggedNotRunning) {
          log(NOT_RUNNING_MESSAGE);
          loggedNotRunning = true;
        }
      }
    },
  };
}
