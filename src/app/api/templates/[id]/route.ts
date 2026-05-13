import { NextRequest, NextResponse } from "next/server";
import {
  deleteCustomTemplate,
  getCustomTemplate,
  updateCustomTemplate,
} from "@/lib/custom-templates";

/**
 * PATCH /api/templates/[id]
 * Edit a custom template in place. Built-in templates are not editable.
 */
export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  if (!id.startsWith("custom-")) {
    return NextResponse.json(
      { error: "built-in templates cannot be edited" },
      { status: 403 }
    );
  }
  const existing = getCustomTemplate(id);
  if (!existing) {
    return NextResponse.json({ error: "template not found" }, { status: 404 });
  }

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

  const updated = updateCustomTemplate(id, body);
  if (!updated) {
    return NextResponse.json(
      { error: "failed to update template" },
      { status: 500 }
    );
  }

  return NextResponse.json({ template: { ...updated, kind: "custom" } });
}

/**
 * DELETE /api/templates/[id]
 * Remove a custom template. Built-in templates cannot be deleted.
 */
export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  if (!id.startsWith("custom-")) {
    return NextResponse.json(
      { error: "built-in templates cannot be deleted" },
      { status: 403 }
    );
  }
  const ok = deleteCustomTemplate(id);
  if (!ok) {
    return NextResponse.json({ error: "template not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
