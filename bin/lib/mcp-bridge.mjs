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
      emit(message);
    }
  } catch {
    // A malformed upstream response must not corrupt the client's stdio stream.
  }
  return wrote;
}

/**
 * Forward newline-delimited JSON-RPC between an MCP stdio client and Employee001.
 */
export function createBridge({ url, fetchImpl = fetch, write, log }) {
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
            error: {
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
