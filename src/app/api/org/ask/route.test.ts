import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/model-provider", () => ({
  canRunModel: vi.fn(() => ({ ok: false, reason: "ANTHROPIC_API_KEY is not configured" })),
}));

import { canRunModel } from "@/lib/model-provider";
import { POST } from "./route";

const savedDemo = process.env.EMPLOYEE001_DEMO;
const savedLive = process.env.EMPLOYEE001_DEMO_LIVE;

beforeEach(() => {
  process.env.EMPLOYEE001_DEMO = "1";
  delete process.env.EMPLOYEE001_DEMO_LIVE;
});

afterEach(() => {
  if (savedDemo === undefined) delete process.env.EMPLOYEE001_DEMO;
  else process.env.EMPLOYEE001_DEMO = savedDemo;
  if (savedLive === undefined) delete process.env.EMPLOYEE001_DEMO_LIVE;
  else process.env.EMPLOYEE001_DEMO_LIVE = savedLive;
  vi.mocked(canRunModel).mockClear();
});

describe("POST /api/org/ask in the replay demo", () => {
  it("streams the demo hint without checking the model provider", async () => {
    const res = await POST(new NextRequest("http://localhost/api/org/ask", {
      method: "POST",
      body: JSON.stringify({ question: "What should we prioritize?" }),
    }));

    expect(res.headers.get("Content-Type")).toBe("text/event-stream");
    expect((await res.text()).split("\n\n").filter(Boolean).map((chunk) => JSON.parse(chunk.replace(/^data: /, "")))).toEqual([
      expect.objectContaining({ type: "answer_delta", delta: expect.stringContaining("npx employee001 demo --live") }),
      { type: "done" },
    ]);
    expect(canRunModel).not.toHaveBeenCalled();
  });
});
