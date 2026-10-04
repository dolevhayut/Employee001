const NOT_RUNNING_MESSAGE = "Employee001 is not running. Start it with: npx employee001 start";

function hasRequestId(message) {
  return Object.prototype.hasOwnProperty.call(message, "id");
}

function writeJson(write, value) {
  write(`${JSON.stringify(value)}\n`);
}

function writeJsonText(write, value) {
  try {
    writeJson(write, JSON.parse(value));
  } catch {
    // MCP clients require stdout to be newline-delimited JSON-RPC only.
  }
}

async function forwardResponse(response, write) {
  const contentType = response.headers.get("content-type") ?? "";
  const body = await response.text();

  if (contentType.toLowerCase().includes("text/event-stream")) {
    for (const line of body.split(/\r?\n/)) {
      if (line.startsWith("data:")) {
        writeJsonText(write, line.slice(5).trimStart());
      }
    }
    return;
  }

  try {
    const payload = JSON.parse(body);
    for (const message of Array.isArray(payload) ? payload : [payload]) {
      writeJson(write, message);
    }
  } catch {
    // A malformed upstream response must not corrupt the client's stdio stream.
  }
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
        await forwardResponse(response, write);
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
