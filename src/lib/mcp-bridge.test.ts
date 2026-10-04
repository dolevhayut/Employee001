import { describe, expect, it, vi } from "vitest";
import { createBridge } from "../../bin/lib/mcp-bridge.mjs";

const request = JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/list" });

function bridgeWith(fetchImpl: typeof fetch, token?: string) {
  const output: string[] = [];
  const log = vi.fn();
  return {
    bridge: createBridge({
      url: "http://127.0.0.1:3000/api/mcp",
      token,
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

  it("sends a Bearer token only when one is configured", async () => {
    const fetchWithToken = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ jsonrpc: "2.0", id: 7, result: {} }));
    const { bridge: tokenBridge } = bridgeWith(fetchWithToken, "lan-token");
    await tokenBridge.handleLine(request);
    expect(fetchWithToken.mock.calls[0][1]).toMatchObject({
      headers: expect.objectContaining({ authorization: "Bearer lan-token" }),
    });

    const fetchWithoutToken = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ jsonrpc: "2.0", id: 7, result: {} }));
    const { bridge: noTokenBridge } = bridgeWith(fetchWithoutToken);
    await noTokenBridge.handleLine(request);
    expect(fetchWithoutToken.mock.calls[0][1]).toMatchObject({
      headers: expect.not.objectContaining({ authorization: expect.anything() }),
    });
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

  it("answers a request when the app replies with a non-JSON error page", async () => {
    const { bridge, output } = bridgeWith(
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response("<html>404</html>", { status: 404, headers: { "content-type": "text/html" } }),
      ),
    );

    await bridge.handleLine(request);

    expect(output).toHaveLength(1);
    const reply = JSON.parse(output[0]);
    expect(reply.id).toBe(7);
    expect(reply.error.code).toBe(-32002);
    expect(reply.error.message).toContain("HTTP 404");
  });

  it("does not hold a fast request behind a slow one", async () => {
    let releaseSlow: (r: Response) => void = () => {};
    const fetchImpl = vi.fn<typeof fetch>()
      .mockReturnValueOnce(new Promise<Response>((r) => { releaseSlow = r; }))
      .mockResolvedValueOnce(Response.json({ jsonrpc: "2.0", id: 2, result: {} }));
    const { bridge, output } = bridgeWith(fetchImpl);

    const slow = bridge.handleLine(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call" }));
    await bridge.handleLine(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "ping" }));
    expect(output.map((l) => JSON.parse(l).id)).toEqual([2]);

    releaseSlow(Response.json({ jsonrpc: "2.0", id: 1, result: {} }));
    await slow;
    expect(output.map((l) => JSON.parse(l).id)).toEqual([2, 1]);
  });
});
