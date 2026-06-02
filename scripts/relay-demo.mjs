// Headless end-to-end demo of the Relay handover pipeline — NO Anthropic key.
//
// Run (dev server must be up):  npx tsx scripts/relay-demo.mjs itai-cohen
//   or with a plain node:       node scripts/relay-demo.mjs itai-cohen
//
// What it does, the morning-demo way:
//   1. POST /api/relay/<id> { synthMode: 'fixture' }  — kicks off the detached
//      runner. Fixture mode reads data/relay/transcripts/<id>.json and writes
//      data/handovers/<id>/rcp.json with ZERO model calls, so no API key is
//      ever required.
//   2. Tails GET /api/relay/<id>/stream (SSE) until the terminal `done` event,
//      printing the phase stepper (consent → capture → synthesize → coverage →
//      write) as it goes.
//   3. Reads the freshly-written rcp.json and prints a human-readable report:
//      coverage score + status, item counts per RCP field, and a couple of
//      real captured decision_rules / edge_cases so a viewer sees actual
//      knowledge, not just green checkmarks.
//
// Exit codes:
//   0  rcp.json present AND coverage status === 'handover-ready'
//   1  anything else (missing file, draft status, server unreachable, timeout)
//
// Config via env:
//   BASE_URL   default http://localhost:3000  (next dev default port)
//   TIMEOUT_MS default 120000

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");

const EMPLOYEE_ID = process.argv[2] || "itai-cohen";
const BASE_URL = (process.env.BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS) || 120_000;

const RCP_PATH = join(REPO, "data", "handovers", EMPLOYEE_ID, "rcp.json");

// Fields scored by the coverage rubric (13.4). source_twin_id / provenance /
// status are document-level and intentionally not counted here.
const SCORED_FIELDS = [
  "decision_rules",
  "playbooks",
  "contact_graph",
  "edge_cases",
  "tooling_map",
  "glossary",
  "open_loops",
];

// ── tiny console helpers ────────────────────────────────────────────────────
const isTTY = process.stdout.isTTY;
const c = (code, s) => (isTTY ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = (s) => c("1", s);
const dim = (s) => c("2", s);
const green = (s) => c("32", s);
const yellow = (s) => c("33", s);
const red = (s) => c("31", s);
const cyan = (s) => c("36", s);

function hr() {
  console.log(dim("─".repeat(72)));
}

function die(msg) {
  console.error(`\n${red("✗ FAIL")} ${msg}`);
  process.exit(1);
}

// ── step 1: kick off the runner ─────────────────────────────────────────────
async function spawnHandover() {
  const url = `${BASE_URL}/api/relay/${EMPLOYEE_ID}`;
  console.log(`${cyan("POST")} ${url}  ${dim("{ synthMode: 'fixture' }")}`);

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ synthMode: "fixture" }),
    });
  } catch (err) {
    die(
      `could not reach dev server at ${BASE_URL} — is it running?\n` +
        `  start it with:  npm run dev   (then re-run with the matching BASE_URL)\n` +
        `  underlying error: ${err?.message ?? err}`
    );
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    die(`POST returned ${res.status} ${res.statusText}\n  ${text.slice(0, 400)}`);
  }

  const body = await res.json().catch(() => ({}));
  const handoverId = body.handoverId ?? body.id ?? "(unknown)";
  console.log(
    `  ${green("→")} runner spawned  handoverId=${bold(handoverId)}` +
      (body.alreadyRunning ? dim("  (already running — rejoining)") : "")
  );
  return body;
}

// ── step 2: tail the SSE stream until `done` ────────────────────────────────
async function tailStream(handoverId) {
  // Pass the handoverId returned by POST so we can reattach even after the
  // (very fast) fixture run has finished and deregistered its active sentinel.
  // Without it the stream route 404s once the run is no longer "active".
  const qs =
    handoverId && handoverId !== "(unknown)"
      ? `?handoverId=${encodeURIComponent(handoverId)}`
      : "";
  const url = `${BASE_URL}/api/relay/${EMPLOYEE_ID}/stream${qs}`;
  console.log(`${cyan("GET ")} ${url}  ${dim("(tailing SSE…)")}\n`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let res;
  try {
    res = await fetch(url, {
      headers: { accept: "text/event-stream" },
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (controller.signal.aborted) return { timedOut: true };
    die(`could not open stream: ${err?.message ?? err}`);
  }

  if (!res.ok || !res.body) {
    clearTimeout(timer);
    die(`stream returned ${res.status} ${res.statusText}`);
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let doneEvent = null;
  const seenPhases = new Set();

  try {
    for await (const chunk of res.body) {
      buffer += decoder.decode(chunk, { stream: true });

      // SSE frames are separated by a blank line. Each frame may have one or
      // more `data:` lines; we only care about the JSON payload.
      let idx;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);

        const dataLines = frame
          .split("\n")
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trim());
        if (dataLines.length === 0) continue; // heartbeat ': ping'

        let evt;
        try {
          evt = JSON.parse(dataLines.join("\n"));
        } catch {
          continue;
        }

        renderEvent(evt, seenPhases);

        if (evt.type === "done") {
          doneEvent = evt;
        }
      }
      if (doneEvent) break;
    }
  } catch (err) {
    if (controller.signal.aborted) {
      clearTimeout(timer);
      return { timedOut: true };
    }
    // Stream closing after a `done` event is normal.
    if (!doneEvent) die(`stream error: ${err?.message ?? err}`);
  } finally {
    clearTimeout(timer);
  }

  return { doneEvent };
}

function renderEvent(evt, seenPhases) {
  switch (evt.type) {
    case "phase":
      if (!seenPhases.has(evt.phase)) {
        seenPhases.add(evt.phase);
        console.log(`  ${cyan("◆")} phase: ${bold(evt.phase)}`);
      }
      break;
    case "consent":
      console.log(`  ${dim("·")} consent ${evt.state}  ${dim(evt.banner ?? "")}`);
      break;
    case "synthesizing":
      console.log(
        `  ${dim("·")} synthesizing  model=${evt.model}  notes=${evt.inputNotes}`
      );
      break;
    case "file_writing":
      console.log(`  ${dim("·")} writing ${evt.path} (${evt.bytes} bytes)`);
      break;
    case "coverage":
      console.log(
        `  ${dim("·")} coverage ${(evt.weightedScore * 100).toFixed(0)}%  → ${evt.status}`
      );
      break;
    case "error":
      console.log(`  ${yellow("!")} ${evt.message}`);
      break;
    case "done":
      break;
    default:
      // capture_note / interview_question — keep the demo readable, summarize.
      if (evt.type === "capture_note" && evt.area) {
        process.stdout.write(`  ${dim("·")} note → ${evt.area}\n`);
      }
  }
}

// ── step 3: read + report the RCP ───────────────────────────────────────────
async function readRcp() {
  if (!existsSync(RCP_PATH)) {
    die(`rcp.json not found at ${RCP_PATH} — the runner did not produce output.`);
  }
  let rcp;
  try {
    rcp = JSON.parse(await readFile(RCP_PATH, "utf8"));
  } catch (err) {
    die(`rcp.json is not valid JSON: ${err?.message ?? err}`);
  }
  return rcp;
}

function report(rcp, doneEvent) {
  hr();
  console.log(bold(`  Role Context Package — ${EMPLOYEE_ID}`));
  hr();

  const status = rcp.status ?? doneEvent?.status ?? "(unknown)";
  const score =
    typeof doneEvent?.weightedScore === "number"
      ? doneEvent.weightedScore
      : undefined;

  console.log(`  schema_version : ${rcp.schema_version}`);
  console.log(`  synth_mode     : ${rcp.synth_mode}`);
  console.log(`  generated_at   : ${rcp.generated_at}`);
  const statusColor = status === "handover-ready" ? green : yellow;
  console.log(
    `  coverage       : ${
      score !== undefined ? bold((score * 100).toFixed(0) + "%") : dim("(from rcp)")
    }   status=${statusColor(status)}`
  );

  // Per-field item counts vs the rubric minimums.
  console.log(`\n  ${bold("Items captured per field")}`);
  const MIN = {
    decision_rules: 4,
    playbooks: 3,
    contact_graph: 4,
    edge_cases: 3,
    tooling_map: 3,
    open_loops: 2,
    glossary: 3,
  };
  for (const field of SCORED_FIELDS) {
    const arr = Array.isArray(rcp[field]) ? rcp[field] : [];
    const min = MIN[field];
    const ok = arr.length >= min;
    const mark = ok ? green("✓") : yellow("○");
    console.log(
      `    ${mark} ${field.padEnd(16)} ${String(arr.length).padStart(2)} / ${min} min`
    );
  }

  const consent = rcp.provenance?.consent;
  if (consent?.banner) {
    console.log(`\n  ${yellow(consent.banner)}`);
  }

  // Sample real captured knowledge so a human sees substance.
  printSamples(rcp, "decision_rules", 2);
  printSamples(rcp, "edge_cases", 2);

  hr();
}

function printSamples(rcp, field, n) {
  const arr = Array.isArray(rcp[field]) ? rcp[field] : [];
  if (arr.length === 0) return;
  console.log(`\n  ${bold(`Sample ${field}`)}`);
  for (const item of arr.slice(0, n)) {
    const title = (item.title || "(untitled)").trim();
    const body = (item.body || "").replace(/\s+/g, " ").trim();
    const conf =
      typeof item.confidence === "number"
        ? dim(`  [conf ${item.confidence}]`)
        : "";
    console.log(`    ${cyan("•")} ${title.slice(0, 70)}${conf}`);
    console.log(`      ${dim(body.slice(0, 200) + (body.length > 200 ? "…" : ""))}`);
  }
}

// ── main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log(bold(`\nRelay handover demo — fixture mode (no Anthropic key needed)\n`));
  console.log(`  employee : ${EMPLOYEE_ID}`);
  console.log(`  base url : ${BASE_URL}`);
  console.log(`  rcp out  : ${RCP_PATH}\n`);

  const spawn = await spawnHandover();
  const handoverId = spawn.handoverId ?? spawn.id;
  const { doneEvent, timedOut } = await tailStream(handoverId);

  if (timedOut) {
    die(`timed out after ${TIMEOUT_MS}ms waiting for the 'done' event.`);
  }
  if (!doneEvent) {
    die(`stream closed without a terminal 'done' event.`);
  }
  if (doneEvent.stoppedReason && doneEvent.stoppedReason !== "natural") {
    console.log(
      `\n  ${yellow("runner stopped:")} ${doneEvent.stoppedReason}`
    );
  }
  console.log(
    `\n  ${green("✓")} done  ` +
      `turns=${doneEvent.turns ?? 0} cost=$${(doneEvent.costUsd ?? 0).toFixed(2)}`
  );

  const rcp = await readRcp();
  report(rcp, doneEvent);

  const finalStatus = rcp.status ?? doneEvent.status;
  if (finalStatus !== "handover-ready") {
    die(
      `coverage status is '${finalStatus}', not 'handover-ready'.\n` +
        `  The RCP was written but does not clear the readiness threshold.`
    );
  }

  console.log(
    `${green("✓ PASS")} — rcp.json written and ${bold("handover-ready")}.\n` +
      dim(`  ${RCP_PATH}\n`)
  );
  process.exit(0);
}

main().catch((err) => {
  die(`unexpected error: ${err?.stack ?? err?.message ?? err}`);
});
