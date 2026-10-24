import * as fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A replay must never reach the model: fail loudly if the route tries.
vi.mock("@/lib/council-runner", () => ({
  runSingleTwin: vi.fn(async () => {
    throw new Error("model call in a replay demo");
  }),
}));

import { runSingleTwin } from "@/lib/council-runner";
import { DEMO_ASK_FALLBACK, findDemoAnswer, normalizeDemoQuestion, parseAskRecording } from "./demo-ask-recording";
import { createDemoAskStream } from "./demo-ask";
import { POST as chat } from "@/app/api/twin/chat/route";
import { GET as demoStatus } from "@/app/api/demo/route";
import { GET as demoAudio } from "@/app/api/demo/audio/[id]/route";

const demoDir = path.resolve(process.cwd(), "bin", "demo");
const askPath = path.join(demoDir, "ask.json");
const recording = parseAskRecording(JSON.parse(fs.readFileSync(askPath, "utf8")));
const ENV_KEYS = ["EMPLOYEE001_DEMO", "EMPLOYEE001_DEMO_LIVE", "EMPLOYEE001_DEMO_ASK", "EMPLOYEE001_DEMO_RECORDING", "EMPLOYEE001_HOME", "ANTHROPIC_API_KEY"] as const;
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
const homes: string[] = [];

beforeEach(() => {
  const home = fs.mkdtempSync(path.join(tmpdir(), "employee001-demo-ask-"));
  homes.push(home);
  fs.cpSync(path.join(demoDir, "data"), path.join(home, "data"), { recursive: true });
  process.env.EMPLOYEE001_HOME = home;
  process.env.EMPLOYEE001_DEMO = "1";
  delete process.env.EMPLOYEE001_DEMO_LIVE;
  process.env.EMPLOYEE001_DEMO_ASK = askPath;
  process.env.EMPLOYEE001_DEMO_RECORDING = path.join(demoDir, "recording.json");
  // A key in the server's environment must not turn the demo into a paid run.
  process.env.ANTHROPIC_API_KEY = "sk-would-spend";
});

afterEach(() => {
  for (const home of homes.splice(0)) fs.rmSync(home, { recursive: true, force: true });
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.mocked(runSingleTwin).mockClear();
});

const ask = (employeeId: string, question: string) =>
  chat(new NextRequest("http://localhost/api/twin/chat", {
    method: "POST",
    body: JSON.stringify({ employeeId, question: `${question}\n\n(Answer in at most three short sentences. Reply in English.)`, followups: false }),
  }));

function events(sse: string): Array<{ type: string; delta?: string; name?: string; args?: { file_path?: string } }> {
  return sse.split("\n\n").filter(Boolean).map((chunk) => JSON.parse(chunk.replace(/^data: /, "")));
}

describe("demo Ask recording", () => {
  it("records 3–4 questions, at least two to the former employee, one of which it declines", () => {
    expect(recording.answers.length).toBeGreaterThanOrEqual(3);
    expect(recording.answers.length).toBeLessThanOrEqual(4);
    const answerText = (id: string) => recording.answers.find((a) => a.id === id)!.events
      .flatMap(({ event }) => (event.type === "text_delta" ? [event.delta] : []))
      .join("");
    const theo = recording.answers.filter((a) => a.employeeId === "theo-lindqvist");
    expect(theo.filter((a) => answerText(a.id).startsWith("From my handover notes:")).length).toBeGreaterThanOrEqual(2);
    expect(theo.some((a) => answerText(a.id).startsWith("I don't know."))).toBe(true);
    for (const answer of recording.answers) {
      expect(fs.existsSync(path.join(demoDir, "data", "employees", answer.employeeId, "employee.json"))).toBe(true);
      const audio = path.join(demoDir, answer.audio!.file);
      expect(fs.statSync(audio).size).toBeLessThan(250 * 1024);
    }
  });

  it("matches a question whatever its case, punctuation or answer-style note", () => {
    expect(normalizeDemoQuestion("  WHO approves a 20% discount now?? \n\n(Answer briefly.)")).toBe("who approves a 20% discount now");
    const first = recording.answers[0];
    expect(findDemoAnswer(recording, first.employeeId, first.question.toUpperCase())?.id).toBe(first.id);
    expect(findDemoAnswer(recording, "someone-else", first.question)).toBeNull();
  });

  it("replays a recorded answer from /api/twin/chat without a model call", async () => {
    const answer = recording.answers.find((a) => a.employeeId === "theo-lindqvist")!;
    const res = await ask(answer.employeeId, answer.question);
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");
    const evts = events(await res.text());
    expect(evts.at(-1)?.type).toBe("done");
    expect(evts.some((e) => e.type === "tool_call" && e.args?.file_path === "/handover/notes.md")).toBe(true);
    expect(evts.filter((e) => e.type === "text_delta").map((e) => e.delta).join("")).toContain("From my handover notes:");
    expect(runSingleTwin).not.toHaveBeenCalled();
  });

  it("answers anything else with the demo hint, still without a model call", async () => {
    const res = await ask("marcus-reed", "Write me a poem about Kubernetes");
    const evts = events(await res.text());
    expect(evts.filter((e) => e.type === "text_delta").map((e) => e.delta).join("")).toBe(DEMO_ASK_FALLBACK);
    expect(DEMO_ASK_FALLBACK).toContain("npx employee001 demo --live");
    expect(runSingleTwin).not.toHaveBeenCalled();
  });

  it("stops replaying when the client goes away", async () => {
    const abort = new AbortController();
    const reader = createDemoAskStream(recording.answers[0], { signal: abort.signal, sleep: async () => { abort.abort(); } }).getReader();
    expect((await reader.read()).done).toBe(true);
  });

  it("lists the suggestions in /api/demo and serves only their audio", async () => {
    const status = await (await demoStatus()).json();
    expect(status.ask.map((a: { id: string }) => a.id)).toEqual(recording.answers.map((a) => a.id));

    const params = (id: string) => ({ params: Promise.resolve({ id }) });
    const ok = await demoAudio(new Request("http://localhost"), params(recording.answers[0].id));
    expect(ok.headers.get("Content-Type")).toBe("audio/mpeg");
    expect((await ok.arrayBuffer()).byteLength).toBeGreaterThan(10_000);
    expect((await demoAudio(new Request("http://localhost"), params("../ask"))).status).toBe(404);

    process.env.EMPLOYEE001_DEMO = "0";
    expect((await demoAudio(new Request("http://localhost"), params(recording.answers[0].id))).status).toBe(404);
  });
});
