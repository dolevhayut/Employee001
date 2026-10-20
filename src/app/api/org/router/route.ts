import { NextRequest } from "next/server";
import { loadEmployeesFromDisk } from "@/lib/employees-disk";
import { getHiredEmployees } from "@/lib/hired-agents";
import { hasEmployeeFiles } from "@/lib/employees-files";
import { dataDir } from "@/lib/app-home";
import { readTwinText, routeQuestion } from "@/lib/org-router";
import { routeWithModel } from "@/lib/org-router-model";

// POST /api/org/router { question } → which twins should answer, and why.
// The organization brain calls this, then runs a team meeting with the picks.
// `by` says which picked: the keyword scorer or the Haiku fallback.
export async function POST(req: NextRequest) {
  let question = "";
  try {
    question = String(((await req.json()) as { question?: unknown }).question ?? "").trim();
  } catch {
    // fall through to the 400
  }
  if (!question) return Response.json({ error: "question is required" }, { status: 400 });

  const fromDisk = await loadEmployeesFromDisk();
  const roster = [...fromDisk, ...getHiredEmployees().filter((h) => !fromDisk.some((e) => e.id === h.id))];
  const twins = roster
    .filter((e) => e.twinStatus === "ready" && hasEmployeeFiles(e.id))
    .map((e) => ({ id: e.id, firstName: e.firstName, name: e.name, role: e.role, text: readTwinText(dataDir("employees", e.id)) }));

  // Keywords first (instant). When they can't decide (nothing matched, or a
  // question in a script the profiles aren't written in), ask Haiku.
  let picks = routeQuestion(question, twins);
  let by: "keywords" | "model" = "keywords";
  const weak = picks[0]?.score < 3 && !picks[0]?.named;
  if (weak) {
    const fromModel = await routeWithModel(question, twins);
    if (fromModel) {
      picks = fromModel;
      by = "model";
    }
  }
  return Response.json({ picks, by }, { headers: { "Cache-Control": "no-store" } });
}
