import { NextRequest, NextResponse } from "next/server";
import { TASK_TEMPLATES, type TaskTemplate } from "@/lib/task-templates";
import {
  createCustomTemplate,
  listCustomTemplates,
} from "@/lib/custom-templates";

type TemplateRecord = TaskTemplate & {
  kind: "builtin" | "custom";
  createdAt?: string;
  updatedAt?: string;
};

/**
 * GET /api/templates
 * Returns the merged list of built-in + custom templates with a `kind` flag.
 * Built-ins always come first; custom templates follow in newest-first order
 * (the storage layer maintains this).
 */
export async function GET(): Promise<NextResponse<{ templates: TemplateRecord[] }>> {
  const builtin: TemplateRecord[] = TASK_TEMPLATES.map((t) => ({
    ...t,
    kind: "builtin",
  }));
  const custom: TemplateRecord[] = listCustomTemplates().map((t) => ({
    ...t,
    kind: "custom",
  }));
  return NextResponse.json({ templates: [...builtin, ...custom] });
}

/**
 * POST /api/templates
 * Create a custom template. Body must include name + task; description, category,
 * appliesTo, and requiresToolkits are optional.
 */
export async function POST(req: NextRequest) {
  let body: {
    name?: string;
    description?: string;
    task?: string;
    category?: string;
    appliesTo?: "all" | string[];
    requiresToolkits?: string[];
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const name = body.name?.trim();
  const task = body.task?.trim();
  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (!task) {
    return NextResponse.json({ error: "task is required" }, { status: 400 });
  }

  const created = createCustomTemplate({
    name,
    description: body.description,
    task,
    category: body.category,
    appliesTo: body.appliesTo,
    requiresToolkits: body.requiresToolkits,
  });

  return NextResponse.json({ template: { ...created, kind: "custom" } });
}
