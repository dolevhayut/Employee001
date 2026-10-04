import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";
import { createDemoReplayStream, type DemoRecording } from "./demo-replay";
import { POST } from "@/app/api/council/chat/route";

const originalDemo = process.env.EMPLOYEE001_DEMO;
const originalLive = process.env.EMPLOYEE001_DEMO_LIVE;
const originalRecording = process.env.EMPLOYEE001_DEMO_RECORDING;
const tempPaths: string[] = [];

afterEach(() => {
  for (const path of tempPaths.splice(0)) fs.rmSync(path, { force: true });
  if (originalDemo === undefined) delete process.env.EMPLOYEE001_DEMO;
  else process.env.EMPLOYEE001_DEMO = originalDemo;
  if (originalLive === undefined) delete process.env.EMPLOYEE001_DEMO_LIVE;
  else process.env.EMPLOYEE001_DEMO_LIVE = originalLive;
  if (originalRecording === undefined) delete process.env.EMPLOYEE001_DEMO_RECORDING;
  else process.env.EMPLOYEE001_DEMO_RECORDING = originalRecording;
});

const recording: DemoRecording = {
  version: 1,
  question: "What should Lumen Labs prioritize this quarter?",
  participantIds: ["maya", "noam"],
  events: [
    { dtMs: 20, event: { type: "employee_start", employeeId: "maya", employeeName: "Maya" } },
    { dtMs: 40, event: { type: "text_delta", employeeId: "maya", delta: "Focus on retention.", ts: 1 } },
    { dtMs: 0, event: { type: "employee_done", employeeId: "maya", confidence: 0.9, turns: 1, costUsd: 0, ts: 2 } },
  ],
};

async function streamText(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let result = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) return result;
    result += decoder.decode(value, { stream: true });
  }
}

describe("demo replay", () => {
  it("writes recorded council frames with their recorded timing", async () => {
    const waits: number[] = [];
    const text = await streamText(createDemoReplayStream(recording, {
      sleep: async (ms) => { waits.push(ms); },
    }));

    expect(waits).toEqual([20, 40]);
    expect(text.trim().split("\n\n")).toHaveLength(3);
    expect(text).toContain('"type":"employee_start"');
    expect(text).toContain('"type":"employee_done"');
  });

  it("stops before the next frame when the client disconnects", async () => {
    const abort = new AbortController();
    const text = await streamText(createDemoReplayStream(recording, {
      signal: abort.signal,
      sleep: async () => { abort.abort(); },
    }));

    expect(text).toBe("");
  });

  it("passes the route request signal into an aborted demo replay", async () => {
    const recordingPath = join(tmpdir(), `employee001-demo-recording-${Date.now()}.json`);
    tempPaths.push(recordingPath);
    fs.writeFileSync(recordingPath, JSON.stringify(recording));
    process.env.EMPLOYEE001_DEMO = "1";
    delete process.env.EMPLOYEE001_DEMO_LIVE;
    process.env.EMPLOYEE001_DEMO_RECORDING = recordingPath;
    const abort = new AbortController();
    abort.abort();

    const response = await POST(new NextRequest("http://localhost/api/council/chat", {
      method: "POST",
      body: JSON.stringify({ question: "ignored in replay" }),
      signal: abort.signal,
    }));

    expect(response.headers.get("Content-Type")).toBe("text/event-stream");
    expect(await response.text()).toBe("");
  });
});
