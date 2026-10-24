import "server-only";
import { relayTurn } from "./relay/model";
import { TWIN_MODEL_PRIMARY } from "./sdk-defaults";

// "Interview me" on Build my twin: instead of writing about their work, the
// person answers a short interview. Stateless: the page sends the exchange
// so far and gets the next question, or DONE. The transcript then becomes
// the twin's material like written notes (self-twin.ts).

export const SELF_INTERVIEW_MAX_QUESTIONS = 8;
const DONE = "DONE";

export type InterviewTurn = { question: string; answer: string };

const SYSTEM = `You interview someone so an AI twin of them can answer their colleagues' questions the way they would. You get their name, role and the interview so far. Ask the single next question.

Cover, in this order, moving on once a topic is answered concretely:
1. What they own and what a good week looks like.
2. Decisions they make often, and the rule or threshold they use.
3. The questions people ask them most, with their usual answer.
4. Who they work with, on what.
5. How they write: ask them to paste two or three short messages they actually sent.
6. What a twin must never decide without them.

Rules:
- One question, under 30 words, plain and friendly. No preamble, no numbering, no praise.
- If the last answer was vague ("it depends", "various things"), ask for one concrete example or number instead of moving on.
- Ask in the language they answer in.
- Never ask for passwords, personal life, health, salary, or anything about a colleague's performance.
- When the six topics are covered, or after ${SELF_INTERVIEW_MAX_QUESTIONS} questions, reply with exactly: ${DONE}`;

export function interviewTranscript(turns: InterviewTurn[]): string {
  return turns.map((t) => `**Q:** ${t.question.trim()}\n\n**A:** ${t.answer.trim()}`).join("\n\n");
}

/** The next question, or null when the interview is complete. */
export async function nextInterviewQuestion(args: { name: string; role: string; turns: InterviewTurn[] }): Promise<string | null> {
  const asked = args.turns.length;
  if (asked >= SELF_INTERVIEW_MAX_QUESTIONS) return null;
  const prompt = [
    `Name: ${args.name.trim().slice(0, 120)}`,
    `Role: ${args.role.trim().slice(0, 120)}`,
    `Questions asked so far: ${asked} of at most ${SELF_INTERVIEW_MAX_QUESTIONS}.`,
    "",
    asked ? `Interview so far:\n\n${interviewTranscript(args.turns).slice(-12_000)}` : "The interview hasn't started. Ask the first question.",
  ].join("\n");
  const reply = (await relayTurn({ employeeId: "self-interview", model: TWIN_MODEL_PRIMARY, system: SYSTEM, prompt })).trim();
  if (!reply || reply.toUpperCase().startsWith(DONE)) return null;
  return reply.split("\n").find((l) => l.trim())?.trim() ?? null;
}
