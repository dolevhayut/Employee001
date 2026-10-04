import { describe, expect, it, vi } from "vitest";
import { createBridge } from "../../bin/lib/mcp-bridge.mjs";

const request = JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/list" });

function bridgeWith(fetchImpl: typeof fetch) {
  const output: string[] = [];
  const log = vi.fn();
  return {
    bridge: createBridge({
      url: "http://127.0.0.1:3000/api/mcp",
      fetchImpl,
      write: (line: string) => output.push(line),
      log,
    }),
    output,
    log,
  };
}

describe("MCP stdio bridge", () => {
  it("forwards JSON responses as newline-delimited JSON-RPC", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify([{ jsonrpc: "2.0", id: 7, result: {} }]), {
        headers: { "content-type": "application/json" },
      }),
    );
    const { bridge, output } = bridgeWith(fetchImpl);

    await bridge.handleLine(request);

    expect(output).toEqual(['{"jsonrpc":"2.0","id":7,"result":{}}\n']);
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://127.0.0.1:3000/api/mcp",
      expect.objectContaining({ method: "POST", body: request }),
    );
  });

  it("forwards JSON messages from SSE data lines", async () => {
    const { bridge, output } = bridgeWith(
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          'event: message\ndata: {"jsonrpc":"2.0","id":7,"result":{"ok":true}}\n\n',
          { headers: { "content-type": "text/event-stream" } },
        ),
      ),
    );

    await bridge.handleLine(request);

    expect(output).toEqual(['{"jsonrpc":"2.0","id":7,"result":{"ok":true}}\n']);
  });

  it("writes nothing for accepted notifications", async () => {
    const { bridge, output } = bridgeWith(
      vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 202 })),
    );

    await bridge.handleLine('{"jsonrpc":"2.0","method":"notifications/initialized"}');

    expect(output).toEqual([]);
  });

  it("returns a JSON-RPC error for unavailable requests and logs it once", async () => {
    const { bridge, output, log } = bridgeWith(vi.fn<typeof fetch>().mockRejectedValue(new Error("offline")));

    await bridge.handleLine(request);
    await bridge.handleLine(request);

    expect(output).toEqual([
      '{"jsonrpc":"2.0","id":7,"error":{"code":-32002,"message":"Employee001 is not running. Start it with: npx employee001 start"}}\n',
      '{"jsonrpc":"2.0","id":7,"error":{"code":-32002,"message":"Employee001 is not running. Start it with: npx employee001 start"}}\n',
    ]);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith("Employee001 is not running. Start it with: npx employee001 start");
  });
});
