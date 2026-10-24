#!/usr/bin/env node
// Builds the demo's recorded Ask answers: bin/demo/ask.json (the event stream
// /api/twin/chat replays in `employee001 demo`) and, with --audio, the spoken
// answers in bin/demo/ask-audio/ (Eleven v4, one voice per twin).
//
//   node scripts/demo-ask.mjs                              # ask.json only
//   node --env-file=.env scripts/demo-ask.mjs --audio      # + audio (ELEVENLABS_API_KEY)
//
// The answers follow the twins' prompts by hand: Theo is retired, so he
// answers from his reviewed handover notes and says when he doesn't know.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const demoDir = path.join(root, "bin", "demo");

// ElevenLabs premade voices: Brian for Theo, Eric for Marcus.
const VOICES = { "theo-lindqvist": "nPczCjzI2devNBz1zQrb", "marcus-reed": "cjVigY5qzO86Huf0OWal" };
const FORMAT = "mp3_44100_64";

const ANSWERS = [
  {
    id: "theo-discount",
    employeeId: "theo-lindqvist",
    question: "Who approves a 20% discount now?",
    reads: ["/handover/notes.md", "/profile/DECISIONS.md"],
    answer:
      "From my handover notes: discounts between 15% and 25% off list needed my sign-off, with a reason in the deal note [[handover]]. " +
      "Since I left, Elise Moreno takes those approvals until a new RevOps lead starts [[handover]]. " +
      "Anything above 25%, or a multi-year price lock, goes to Amara [[handover]].",
  },
  {
    id: "theo-harbormetric",
    employeeId: "theo-lindqvist",
    question: "What should I know about the HarborMetric renewal?",
    reads: ["/handover/notes.md"],
    answer:
      "From my handover notes: HarborMetric renews on December 15, and their procurement asks for a security questionnaire every year, so start it in October and send it to Priya first [[handover]]. " +
      "When I left on September 26, the renewal quote was drafted in HubSpot but not sent, waiting on that questionnaire [[handover]]. " +
      "I don't know where it stands now.",
  },
  {
    id: "theo-churn",
    employeeId: "theo-lindqvist",
    question: "What's our churn rate this quarter?",
    reads: ["/handover/notes.md"],
    answer:
      "I don't know. I left on September 26, and nothing in my profile or handover notes covers churn, so I won't guess. " +
      "Someone on the team today will have the current number.",
  },
  {
    id: "marcus-sso",
    employeeId: "marcus-reed",
    question: "Is SSO ready for general availability?",
    reads: ["/profile/CONTEXT.md", "/profile/PEOPLE.md", "/profile/DECISIONS.md"],
    answer:
      "Not yet: the SAML happy path works, but SSO deprovisioning, JIT role mapping and audit events are still open [[profile]]. " +
      "November 21 is a realistic engineering-complete date if we keep new scope off the release train [[profile]]. " +
      "Priya signs the security gate, not me [[profile]].",
  },
];

/** The recorded stream: the reads the twin made, then the answer in small chunks. */
function events({ reads, answer }) {
  const out = [];
  let ts = 0;
  const push = (dtMs, event) => {
    ts += dtMs;
    out.push({ dtMs, event: { ...event, ts } });
  };
  reads.forEach((file, i) => {
    push(i === 0 ? 180 : 240, { type: "tool_call", name: "Read", args: { file_path: file } });
    push(320, { type: "tool_result", name: "result", summary: "ok", files: [] });
  });
  const words = answer.split(" ");
  for (let i = 0; i < words.length; i += 4) {
    const chunk = words.slice(i, i + 4).join(" ") + (i + 4 < words.length ? " " : "");
    push(i === 0 ? 420 : 55, { type: "text_delta", delta: chunk });
  }
  push(120, { type: "done", confidence: 0.86, cited_files: [] });
  return out;
}

const spoken = (answer) => answer.replace(/\s*\[\[[^\]]*\]\]/g, "");

async function render(answer) {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error("ELEVENLABS_API_KEY is not set (run with node --env-file=.env).");
  const voice = VOICES[answer.employeeId];
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=${FORMAT}`, {
    method: "POST",
    headers: { "xi-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({ text: spoken(answer.answer), model_id: "eleven_v4", voice_settings: { stability: 0.5, similarity_boost: 0.75 } }),
  });
  if (!res.ok) throw new Error(`ElevenLabs ${res.status} for ${answer.id}: ${(await res.text()).slice(0, 200)}`);
  const file = path.join(demoDir, "ask-audio", `${answer.id}.mp3`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  console.log(`${answer.id}: ${(fs.statSync(file).size / 1024).toFixed(0)} KB`);
}

const recording = {
  version: 1,
  answers: ANSWERS.map((a) => ({
    id: a.id,
    employeeId: a.employeeId,
    question: a.question,
    audio: { file: `ask-audio/${a.id}.mp3`, voiceId: VOICES[a.employeeId] },
    events: events(a),
  })),
};
fs.writeFileSync(path.join(demoDir, "ask.json"), JSON.stringify(recording, null, 2) + "\n");
console.log(`wrote bin/demo/ask.json (${recording.answers.length} answers)`);

if (process.argv.includes("--audio")) {
  for (const answer of ANSWERS) await render(answer);
}
