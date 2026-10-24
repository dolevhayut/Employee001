import { NextRequest } from "next/server";
import { sessionUserFromHeaders } from "@/lib/auth/request-user";
import { appendAuditEntry } from "@/lib/audit-log";
import { loadHandoverState } from "@/lib/relay/handover-state";
import {
  PACKAGE_FIELDS,
  applyItemEdit,
  approvePackage,
  packageMarkdown,
  savePackage,
  type ItemEdit,
  type PackageField,
} from "@/lib/relay/package-store";

export const runtime = "nodejs";

/**
 * Download the handover package: `?format=md` (readable, with sources, the
 * default) or `?format=json` (the portable rcp.json). Every download is
 * audited.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ employeeId: string }> }) {
  const { employeeId } = await ctx.params;
  const state = await loadHandoverState(employeeId);
  if (!state?.package) return Response.json({ error: "No handover package yet" }, { status: 404 });
  const format = new URL(req.url).searchParams.get("format") === "json" ? "json" : "md";
  const me = sessionUserFromHeaders(req.headers);
  appendAuditEntry({
    runId: `relay-download-${Date.now()}`,
    employeeId,
    employeeName: state.name,
    toolName: "relay.downloadPackage",
    bareName: "relay.downloadPackage",
    input: { format, reviewed: Boolean(state.package.review), itemCount: state.package.provenance.itemCount },
    verdict: "executed",
    approvalChannel: "ui",
    ...(me ? { requesterId: me.id } : {}),
  });
  const base = `handover-${employeeId}`;
  if (format === "json") {
    return new Response(JSON.stringify(state.package, null, 2), {
      headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="${base}.rcp.json"` },
    });
  }
  const md = packageMarkdown(state.package, { name: state.name, role: state.role, withSources: true });
  return new Response(md, {
    headers: { "Content-Type": "text/markdown; charset=utf-8", "Content-Disposition": `attachment; filename="${base}.md"` },
  });
}

const isField = (v: unknown): v is PackageField => PACKAGE_FIELDS.includes(v as PackageField);

/**
 * Review the package. Body: `{ op: "remove", field, itemId }`,
 * `{ op: "update", field, itemId, title?, body? }`, or `{ op: "approve" }`
 * (admins only). Edits clear an earlier approval.
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ employeeId: string }> }) {
  const { employeeId } = await ctx.params;
  const state = await loadHandoverState(employeeId);
  if (!state?.package) return Response.json({ error: "No handover package yet" }, { status: 404 });
  if (state.lifecycle !== "handover") return Response.json({ error: "The package can be changed only during the handover." }, { status: 409 });
  const me = sessionUserFromHeaders(req.headers);
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  let next = null;
  if (body.op === "approve") {
    if (me?.role === "employee") return Response.json({ error: "An admin approves the package." }, { status: 403 });
    next = approvePackage(state.package, me?.id);
  } else if ((body.op === "remove" || body.op === "update") && isField(body.field) && typeof body.itemId === "string") {
    const edit: ItemEdit = body.op === "remove"
      ? { op: "remove", field: body.field, itemId: body.itemId }
      : {
          op: "update",
          field: body.field,
          itemId: body.itemId,
          ...(typeof body.title === "string" ? { title: body.title } : {}),
          ...(typeof body.body === "string" ? { body: body.body } : {}),
        };
    next = applyItemEdit(state.package, edit);
    if (!next) return Response.json({ error: "Item not found" }, { status: 404 });
  } else {
    return Response.json({ error: "Unknown edit" }, { status: 400 });
  }

  await savePackage(employeeId, next);
  appendAuditEntry({
    runId: `relay-review-${Date.now()}`,
    employeeId,
    employeeName: state.name,
    toolName: `relay.package.${String(body.op)}`,
    bareName: `relay.package.${String(body.op)}`,
    input: { field: body.field ?? null, itemId: body.itemId ?? null },
    verdict: "executed",
    approvalChannel: "ui",
    ...(me ? { requesterId: me.id } : {}),
  });
  return Response.json(await loadHandoverState(employeeId));
}
