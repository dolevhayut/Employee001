import fs from "fs";
import path from "path";

// Workspace operation mode — the EmployeeX toggle.
//
//   "base" — Employee001 classic: a twin you talk to. You initiate, you're
//            present, approvals happen inline in the conversation.
//   "x"    — EmployeeX: twins accept work and act unattended. Unlocks the
//            operator surfaces (Cockpit, Inbox, Audit, Budgets, Routines,
//            Focus) AND arms autonomous execution.
//
// This is a workspace setting, not UI state: flipping it OFF is the kill
// switch — the routine scheduler stops firing scheduled/catch-up work.
// That's why it lives server-side in data/, not in localStorage.

export type WorkspaceMode = "base" | "x";

const FILE = () => path.join(process.cwd(), "data", "workspace-mode.json");

type ModeRecord = {
  mode: WorkspaceMode;
  /** Last transition, for the audit trail and the settings UI. */
  changedAt: string;
};

const DEFAULT: ModeRecord = { mode: "base", changedAt: new Date(0).toISOString() };

export function getWorkspaceMode(): WorkspaceMode {
  return readRecord().mode;
}

export function getWorkspaceModeRecord(): ModeRecord {
  return readRecord();
}

export function setWorkspaceMode(mode: WorkspaceMode): ModeRecord {
  const record: ModeRecord = { mode, changedAt: new Date().toISOString() };
  const file = FILE();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(record, null, 2) + "\n", "utf8");
  return record;
}

/** True when autonomous (unattended) execution is armed. */
export function isAutonomyArmed(): boolean {
  return getWorkspaceMode() === "x";
}

function readRecord(): ModeRecord {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE(), "utf8")) as Partial<ModeRecord>;
    if (raw.mode === "x" || raw.mode === "base") {
      return { mode: raw.mode, changedAt: raw.changedAt ?? DEFAULT.changedAt };
    }
  } catch {
    // Missing or corrupt file → safe default: autonomy disarmed.
  }
  return DEFAULT;
}
