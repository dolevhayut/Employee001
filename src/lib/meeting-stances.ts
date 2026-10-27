// Who accepted or objected to a meeting's decision, and in which turn they
// said so. Pure helpers (no server-only imports) so the UI and tests share them.

export type MeetingStance = {
  employeeId: string;
  stance: "accept" | "object";
  /** 0-based index into the meeting transcript of the turn that states it. */
  turn: number;
};

type TurnLike = { kind: "ceo" } | { kind: "twin"; employeeId: string };

/**
 * Keep only stances the transcript backs up: a known stance value, and a turn
 * that exists and was spoken by that twin. One stance per twin (the last one
 * wins, since a twin can change their mind). Anything else is dropped, so a
 * model slip never links to somebody else's words.
 */
export function normalizeStances(raw: unknown, transcript: TurnLike[]): MeetingStance[] {
  if (!Array.isArray(raw)) return [];
  const byTwin = new Map<string, MeetingStance>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const { employeeId, stance, turn } = item as Record<string, unknown>;
    if (typeof employeeId !== "string" || (stance !== "accept" && stance !== "object")) continue;
    if (typeof turn !== "number" || !Number.isInteger(turn)) continue;
    const spoken = transcript[turn];
    if (!spoken || spoken.kind !== "twin" || spoken.employeeId !== employeeId) continue;
    const prev = byTwin.get(employeeId);
    if (!prev || turn >= prev.turn) byTwin.set(employeeId, { employeeId, stance, turn });
  }
  return [...byTwin.values()].sort((a, b) => a.turn - b.turn);
}
