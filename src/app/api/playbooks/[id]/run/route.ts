import { NextRequest, NextResponse } from "next/server";
import { getPlaybook } from "@/lib/playbooks/store";
import { runPlaybook } from "@/lib/playbooks/runner";
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const playbook = getPlaybook(id);
  if (!playbook)
    return NextResponse.json({ error: "playbook not found" }, { status: 404 });
  let body: { inputs?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const inputs = body.inputs;
  if (
    !inputs ||
    typeof inputs !== "object" ||
    Array.isArray(inputs) ||
    Object.values(inputs).some((value) => typeof value !== "string")
  )
    return NextResponse.json(
      { error: "inputs must be a string map" },
      { status: 400 },
    );
  for (const input of playbook.inputs)
    if (!(input.key in inputs))
      return NextResponse.json(
        { error: `missing input: ${input.key}` },
        { status: 400 },
      );
  return NextResponse.json(
    await runPlaybook(playbook, inputs as Record<string, string>),
  );
}
