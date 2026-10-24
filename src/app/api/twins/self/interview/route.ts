import { NextResponse } from "next/server";
import { canRunModel, modelErrorMessage } from "@/lib/model-provider";
import { nextInterviewQuestion, SELF_INTERVIEW_MAX_QUESTIONS, type InterviewTurn } from "@/lib/self-interview";

export const runtime = "nodejs";

/** "Interview me" on Build my twin: POST { name, role, turns: [{question, answer}] }
 *  → { question } for the next one, or { done: true }. Stateless; the page
 *  keeps the transcript and submits it as the twin's notes. */
export async function POST(request: Request) {
  let body: { name?: unknown; role?: unknown; turns?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const role = typeof body.role === "string" ? body.role.trim() : "";
  if (!name || !role) return NextResponse.json({ error: "Your name and role come first." }, { status: 400 });
  const turns: InterviewTurn[] = Array.isArray(body.turns)
    ? body.turns
        .filter((t): t is InterviewTurn => typeof t?.question === "string" && typeof t?.answer === "string")
        .slice(0, SELF_INTERVIEW_MAX_QUESTIONS)
        .map((t) => ({ question: t.question.slice(0, 500), answer: t.answer.slice(0, 6_000) }))
    : [];
  const model = canRunModel();
  if (!model.ok) return NextResponse.json({ error: model.reason }, { status: 409 });
  try {
    const question = await nextInterviewQuestion({ name, role, turns });
    return NextResponse.json(question ? { question } : { done: true });
  } catch (err) {
    return NextResponse.json({ error: modelErrorMessage(err instanceof Error ? err.message : String(err)) }, { status: 502 });
  }
}
