import { loadEmployeesFromDisk } from "@/lib/employees-disk";
import { getHiredEmployees } from "@/lib/hired-agents";
import {
  getAssignedOrgSkillIdsForEmployee,
  listOrgSkills,
  setAssignedOrgSkillIds,
} from "@/lib/org-skills";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const fromDisk = await loadEmployeesFromDisk();
  const roster = [
    ...fromDisk,
    ...getHiredEmployees().filter((h) => !fromDisk.some((e) => e.id === h.id)),
  ];
  const employee = roster.find((e) => e.id === id);
  const assignedSkillIds = getAssignedOrgSkillIdsForEmployee(
    id,
    employee?.orgSkillIds ?? []
  );

  return Response.json(
    { skills: listOrgSkills(), assignedSkillIds },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const body = (await request.json()) as { skillIds?: string[] };
  if (!Array.isArray(body.skillIds)) {
    return Response.json({ error: "skillIds must be an array" }, { status: 400 });
  }

  const assignedSkillIds = setAssignedOrgSkillIds(id, body.skillIds);
  return Response.json({ assignedSkillIds });
}
