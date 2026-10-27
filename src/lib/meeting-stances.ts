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
 * Keep only stances the transcript backs up: a known stance value, a turn
 * that exists and was spoken by that twin, and (when given) a twin on the
 * roster. One stance per twin (the last one wins, since a twin can change
 * their mind). Anything else is dropped, so a model slip never links to
 * somebody else's words.
 *
 * `turns` may be a tail of the transcript; `offset` is the index of turns[0]
 * in the full transcript, and the returned `turn` values are full-transcript.
 */
export function normalizeStances(
  raw: unknown,
  turns: TurnLike[],
  offset = 0,
  roster?: Set<string>,
): MeetingStance[] {
  if (!Array.isArray(raw)) return [];
  const byTwin = new Map<string, MeetingStance>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const { employeeId, stance, turn: rawTurn } = item as Record<string, unknown>;
    if (typeof employeeId !== "string" || (stance !== "accept" && stance !== "object")) continue;
    if (roster && !roster.has(employeeId)) continue;
    // Models sometimes quote the number ("7"); accept that, but nothing fuzzier.
    const turn = typeof rawTurn === "string" && /^\d+$/.test(rawTurn) ? Number(rawTurn) : rawTurn;
    if (typeof turn !== "number" || !Number.isInteger(turn)) continue;
    const spoken = turns[turn - offset];
    if (!spoken || spoken.kind !== "twin" || spoken.employeeId !== employeeId) continue;
    const prev = byTwin.get(employeeId);
    if (!prev || turn >= prev.turn) byTwin.set(employeeId, { employeeId, stance, turn });
  }
  return [...byTwin.values()].sort((a, b) => a.turn - b.turn);
}
