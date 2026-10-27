import "server-only";
import { listMeetings, type Meeting, type MeetingBrief, type MeetingDigest, type MeetingSummary, type MeetingTurn, type SharedFile } from "@/lib/meeting-store";
import { loadEmployeesFromDisk } from "@/lib/employees-disk";
import { getHiredEmployees } from "@/lib/hired-agents";

// Read models for the Team Meeting history (GET /api/council/meetings[/id]).

export type MeetingParticipant = { id: string; name: string };

export type MeetingListItem = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  participants: MeetingParticipant[];
  turnCount: number;
  hasSummary: boolean;
  decision?: string;
};

export type MeetingDetail = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  participants: MeetingParticipant[];
  transcript: MeetingTurn[];
  sharedFiles: SharedFile[];
  summary: MeetingSummary | null;
  /** Meeting memory: the record kept for later meetings, the brief this one
   *  started from, and whether it is kept out of later briefs. */
  digest: MeetingDigest | null;
  brief: MeetingBrief | null;
  forget: boolean;
};

type Namer = (m: Meeting, id: string) => string;

/** Names are resolved at read time, never stored: a deleted twin's name must
 *  not survive in the meeting record. Falls back to the name on their turns. */
async function participantNamer(): Promise<Namer> {
  const fromDisk = await loadEmployeesFromDisk();
  const roster = [...fromDisk, ...getHiredEmployees().filter((h) => !fromDisk.some((e) => e.id === h.id))];
  const names = new Map(roster.map((e) => [e.id, e.firstName]));
  return (m, id) => {
    const known = names.get(id);
    if (known) return known;
    for (const t of m.transcript) if (t.kind === "twin" && t.employeeId === id) return t.employeeName;
    return id;
  };
}

const participantsOf = (m: Meeting, nameOf: Namer): MeetingParticipant[] =>
  m.participantIds.map((id) => ({ id, name: nameOf(m, id) }));

/** Meetings with at least one turn, newest activity first. */
export async function meetingHistory(): Promise<MeetingListItem[]> {
  const nameOf = await participantNamer();
  return listMeetings()
    .filter((m) => m.transcript.length > 0)
    .map((m) => ({
      id: m.id,
      title: m.title,
      createdAt: m.createdAt,
      updatedAt: m.updatedAt,
      participants: participantsOf(m, nameOf),
      turnCount: m.transcript.length,
      hasSummary: Boolean(m.summary),
      ...(m.summary?.decision || m.digest?.decision ? { decision: m.summary?.decision || m.digest?.decision } : {}),
    }));
}

export async function meetingDetail(m: Meeting): Promise<MeetingDetail> {
  const nameOf = await participantNamer();
  return {
    id: m.id,
    title: m.title,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
    participants: participantsOf(m, nameOf),
    transcript: m.transcript,
    sharedFiles: m.sharedFiles,
    summary: m.summary ?? null,
    digest: m.digest ?? null,
    brief: m.brief ?? null,
    forget: m.forget === true,
  };
}
