// Routes a question about the organization to the twins who can answer it.
//
// Scores every ready twin against the question: a twin named in the question
// is always asked; otherwise rare words that appear in a twin's role and
// profile count most. Returns the best one to three twins with the words that
// matched, so the UI can say why each was asked. No model call.

import fs from "fs";
import path from "path";
import { PROFILE_FILES } from "@/lib/profile-relevance";

export type RouteCandidate = {
  id: string;
  firstName: string;
  name: string;
  role: string;
  /** Profile text; read from disk when omitted. */
  text?: string;
};

export type RoutePick = { id: string; score: number; matched: string[]; named: boolean };

const STOP = new Set(
  "the a an and or but of to in on for with at by from is are was were be been it this that these those what which who whom how why when where do does did can could should would will you your our we i me my about into than then them they their there here have has had not no yes please just also more most very any some all each our us company team org organization anyone everyone someone right now currently today week thing things know tell give get make need want שלום תודה מה מי איך למה מתי איפה של על את עם זה זו יש אין כל גם או אבל רק עוד כמה החברה הארגון".split(
    " ",
  ),
);

function terms(text: string): string[] {
  return [
    ...new Set(
      text
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((w) => w.length >= 3 && !STOP.has(w)),
    ),
  ];
}

export function readTwinText(employeeDir: string): string {
  return PROFILE_FILES.map((f) => {
    try {
      return fs.readFileSync(path.join(employeeDir, f), "utf8");
    } catch {
      return "";
    }
  }).join("\n");
}

export function routeQuestion(question: string, twins: RouteCandidate[], max = 3): RoutePick[] {
  if (twins.length === 0) return [];
  const q = terms(question);
  const lowerQ = question.toLowerCase();
  const docs = twins.map((t) => ({
    twin: t,
    // The role counts three times: it is the strongest signal of who owns what.
    body: `${t.role} ${t.role} ${t.role}\n${t.text ?? ""}`.toLowerCase(),
  }));

  const picks: RoutePick[] = docs.map(({ twin, body }) => {
    const named = [twin.firstName, twin.name].some((n) => n && lowerQ.includes(n.toLowerCase()));
    let score = named ? 100 : 0;
    const matched: { term: string; w: number }[] = [];
    for (const term of q) {
      const hits = body.split(term).length - 1;
      if (!hits) continue;
      const df = docs.filter((d) => d.body.includes(term)).length;
      const w = Math.log(1 + docs.length / df) * Math.min(3, 1 + Math.log(hits));
      score += w;
      matched.push({ term, w });
    }
    matched.sort((a, b) => b.w - a.w);
    return { id: twin.id, score, matched: matched.slice(0, 3).map((m) => m.term), named };
  });

  picks.sort((a, b) => b.score - a.score);
  const top = picks[0].score;
  // Nothing matched: fall back to the first twin (usually the founder/CEO-facing one).
  if (top <= 0) return [{ ...picks[0], matched: [] }];
  return picks.filter((p) => p.named || p.score >= Math.max(1, top * 0.45)).slice(0, max);
}
