import { MARKETPLACE_AGENTS } from "@/lib/marketplace";
import { getHiredAgentIds } from "@/lib/hired-agents";

export async function GET() {
  const hiredIds = getHiredAgentIds();
  const agents = MARKETPLACE_AGENTS.map((a) => ({
    id: a.id,
    name: a.name,
    firstName: a.firstName,
    role: a.role,
    department: a.department,
    initials: a.initials,
    avatarColor: a.avatarColor,
    category: a.category,
    tagline: a.tagline,
    skills: a.skills,
    suggestedToolkits: a.suggestedToolkits,
    hired: hiredIds.includes(a.id),
  }));

  return Response.json(agents, { headers: { "Cache-Control": "no-store" } });
}
