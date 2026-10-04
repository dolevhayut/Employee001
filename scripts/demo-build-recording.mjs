#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..");
const meetingPath = path.join(root, "bin", "demo", "meeting.md");
const outputPath = path.join(root, "bin", "demo", "recording.json");

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function parseMeeting(source) {
  const frontMatter = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!frontMatter) throw new Error("meeting.md must begin with YAML-style front matter");

  const lines = frontMatter[1].split(/\r?\n/);
  const questionLine = lines.find((line) => line.startsWith("question:"));
  if (!questionLine) throw new Error("meeting.md front matter needs question:");
  const question = questionLine.slice("question:".length).trim().replace(/^['\"]|['\"]$/g, "");
  const participantsIndex = lines.findIndex((line) => line.trim() === "participants:");
  if (participantsIndex < 0) throw new Error("meeting.md front matter needs participants:");
  const participantIds = lines.slice(participantsIndex + 1)
    .filter((line) => /^\s*-\s+/.test(line))
    .map((line) => line.replace(/^\s*-\s+/, "").trim());
  if (!question || participantIds.length === 0) throw new Error("meeting.md needs a question and participants");

  const turns = [];
  const sections = frontMatter[2].split(/^##\s+/m).filter((section) => section.trim());
  for (const section of sections) {
    const [heading, ...body] = section.split(/\r?\n/);
    const employeeId = heading.trim();
    const text = body
      .filter((line) => !line.startsWith("> tool:"))
      .join("\n")
      .trim();
    if (!participantIds.includes(employeeId)) {
      throw new Error(`Unknown participant section: ${employeeId}`);
    }
    if (!text) throw new Error(`Empty meeting turn for ${employeeId}`);
    turns.push({ employeeId, text });
  }
  if (turns.length < 4 || turns.length > 5) {
    throw new Error("meeting.md must contain four or five turns");
  }
  return { question, participantIds, turns };
}

function chunksFor(text, random) {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const chunks = [];
  for (let index = 0; index < words.length;) {
    const count = 3 + Math.floor(random() * 4);
    const next = words.slice(index, index + count).join(" ");
    index += count;
    chunks.push(index < words.length ? `${next} ` : next);
  }
  return chunks;
}

function main() {
  const meeting = parseMeeting(fs.readFileSync(meetingPath, "utf8"));
  const names = new Map();
  for (const id of meeting.participantIds) {
    const sidecar = JSON.parse(fs.readFileSync(path.join(root, "bin", "demo", "data", "employees", id, "employee.json"), "utf8"));
    names.set(id, sidecar.name);
  }

  const random = seededRandom(107);
  const events = [];
  let elapsed = 0;
  for (let turnIndex = 0; turnIndex < meeting.turns.length; turnIndex++) {
    const turn = meeting.turns[turnIndex];
    const startDelay = turnIndex === 0 ? 0 : 850;
    elapsed += startDelay;
    events.push({
      dtMs: startDelay,
      event: { type: "employee_start", employeeId: turn.employeeId, employeeName: names.get(turn.employeeId) },
    });
    for (const delta of chunksFor(turn.text, random)) {
      const dtMs = 30 + Math.floor(random() * 31);
      elapsed += dtMs;
      events.push({ dtMs, event: { type: "text_delta", employeeId: turn.employeeId, delta, ts: elapsed } });
    }
    const doneDelay = 180;
    elapsed += doneDelay;
    events.push({
      dtMs: doneDelay,
      event: {
        type: "employee_done",
        employeeId: turn.employeeId,
        confidence: 0.88,
        turns: 1,
        costUsd: 0,
        stoppedReason: "natural",
        ts: elapsed,
      },
    });
  }
  events.push({ dtMs: 250, event: { type: "council_done" } });

  fs.writeFileSync(outputPath, `${JSON.stringify({ version: 1, question: meeting.question, participantIds: meeting.participantIds, events }, null, 2)}\n`);
}

main();
