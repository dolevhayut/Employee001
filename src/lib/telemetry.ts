import "server-only";

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadEmployeesFromDisk } from "@/lib/employees-disk";
import pkg from "../../package.json";
import { dataDir } from "@/lib/app-home";

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const SETTINGS_FILE = () => dataDir("settings.json");

type StoredSettings = {
  telemetry?: TelemetrySettings;
  [key: string]: unknown;
};

export type TelemetrySettings = {
  consent: boolean;
  installId?: string;
  lastSentAt?: string;
};

export type TelemetryMetrics = {
  activeTwins: number;
  meetings7d: number;
  approvals7d: number;
};

export type TelemetryPayload = {
  install_id?: string;
  version: string;
  node_major: number;
  os: string;
  active_twins: number;
  meetings_7d: number;
  approvals_7d: number;
};

/** Builds a payload from already-sanitised aggregate values; it does no I/O. */
export function buildTelemetryPayload(input: TelemetryMetrics & { installId?: string; version: string; nodeMajor: number; os: string }): TelemetryPayload {
  return {
    ...(input.installId ? { install_id: input.installId } : {}),
    version: input.version,
    node_major: input.nodeMajor,
    os: input.os,
    active_twins: input.activeTwins,
    meetings_7d: input.meetings7d,
    approvals_7d: input.approvals7d,
  };
}

export function getTelemetrySettings(): TelemetrySettings {
  try {
    const settings = JSON.parse(fs.readFileSync(SETTINGS_FILE(), "utf8")) as StoredSettings;
    const telemetry = settings.telemetry;
    return {
      consent: telemetry?.consent === true,
      ...(typeof telemetry?.installId === "string" ? { installId: telemetry.installId } : {}),
      ...(typeof telemetry?.lastSentAt === "string" ? { lastSentAt: telemetry.lastSentAt } : {}),
    };
  } catch {
    return { consent: false };
  }
}

export function setTelemetryConsent(consent: boolean): TelemetrySettings {
  let settings: StoredSettings = {};
  try {
    const parsed = JSON.parse(fs.readFileSync(SETTINGS_FILE(), "utf8"));
    if (parsed && typeof parsed === "object") settings = parsed as StoredSettings;
  } catch {
    // A missing or invalid settings file is safely replaced with this setting.
  }
  const prior = getTelemetrySettings();
  const telemetry: TelemetrySettings = consent
    ? { consent: true, installId: prior.installId ?? randomUUID(), ...(prior.lastSentAt ? { lastSentAt: prior.lastSentAt } : {}) }
    : { consent: false };
  const file = SETTINGS_FILE();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ ...settings, telemetry }, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, file);
  return telemetry;
}

/** True only when consent, a destination, and the 24-hour interval all hold. */
export function shouldSend(settings: TelemetrySettings, url = process.env.EMPLOYEE001_TELEMETRY_URL, now = Date.now()): boolean {
  if (!settings.consent || !settings.installId || !url) return false;
  const lastSent = settings.lastSentAt ? Date.parse(settings.lastSentAt) : Number.NaN;
  return Number.isNaN(lastSent) || now - lastSent >= DAY_MS;
}

function isInLastWeek(value: unknown, now: number): boolean {
  const time = typeof value === "number" ? value : typeof value === "string" ? Date.parse(value) : Number.NaN;
  return !Number.isNaN(time) && time >= now - WEEK_MS && time <= now;
}

function countRecentMeetingDirectories(now: number): number {
  try {
    return fs.readdirSync(dataDir("meetings"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .filter((entry) => isInLastWeek(fs.statSync(dataDir("meetings", entry.name)).birthtimeMs, now))
      .length;
  } catch {
    return 0;
  }
}

function countRecentApprovals(now: number): number {
  try {
    const root = dataDir("shifts");
    return fs.readdirSync(root, { withFileTypes: true }).reduce((count, entry) => {
      if (!entry.isDirectory()) return count;
      try {
        const manifest = JSON.parse(fs.readFileSync(path.join(root, entry.name, "manifest.json"), "utf8")) as { approvals?: Array<{ ts?: string }> };
        return count + (manifest.approvals ?? []).filter((approval) => isInLastWeek(approval.ts, now)).length;
      } catch {
        return count;
      }
    }, 0);
  } catch {
    return 0;
  }
}

async function collectMetrics(now: number): Promise<TelemetryMetrics> {
  const twins = await loadEmployeesFromDisk();
  return {
    activeTwins: twins.filter((twin) => twin.twinStatus === "ready").length,
    meetings7d: countRecentMeetingDirectories(now),
    approvals7d: countRecentApprovals(now),
  };
}

function runtimePayloadInput(metrics: TelemetryMetrics, installId?: string) {
  return {
    ...metrics,
    ...(installId ? { installId } : {}),
    version: pkg.version,
    nodeMajor: Number(process.versions.node.split(".")[0]),
    os: os.platform(),
  };
}

export async function getTelemetryPreview(): Promise<TelemetryPayload> {
  const settings = getTelemetrySettings();
  return buildTelemetryPayload(runtimePayloadInput(await collectMetrics(Date.now()), settings.installId));
}

/** Sends aggregate telemetry at most once daily. Network failures are intentionally silent. */
export async function sendIfDue(): Promise<void> {
  const url = process.env.EMPLOYEE001_TELEMETRY_URL;
  const settings = getTelemetrySettings();
  const now = Date.now();
  if (!shouldSend(settings, url, now) || !url) return;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3_000);
  try {
    const payload = buildTelemetryPayload(runtimePayloadInput(await collectMetrics(now), settings.installId));
    // Persist before sending so retries and concurrent callers cannot exceed the daily cap.
    const updated = { ...settings, lastSentAt: new Date(now).toISOString() };
    const current = getTelemetrySettings();
    if (current.consent && current.installId === settings.installId) {
      let all: StoredSettings = {};
      try { all = JSON.parse(fs.readFileSync(SETTINGS_FILE(), "utf8")) as StoredSettings; } catch { /* safe default */ }
      const file = SETTINGS_FILE();
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify({ ...all, telemetry: updated }, null, 2) + "\n", "utf8");
    }
    void fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: controller.signal })
      .catch(() => {})
      .finally(() => clearTimeout(timer));
  } catch {
    // Telemetry must never affect the local application.
    clearTimeout(timer);
  }
}
