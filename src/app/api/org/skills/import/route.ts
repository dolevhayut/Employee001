import { importOrgSkillMarkdown } from "@/lib/org-skills";

export async function POST(request: Request) {
  const body = (await request.json()) as {
    files?: Array<{ filename?: string; content?: string }>;
  };

  const files = body.files ?? [];
  if (files.length === 0) {
    return Response.json({ error: "files are required" }, { status: 400 });
  }

  const imported = [];
  const errors = [];

  for (const file of files) {
    if (!file.filename || !file.content) {
      errors.push({ filename: file.filename ?? "unknown", error: "missing filename or content" });
      continue;
    }

    try {
      imported.push(
        importOrgSkillMarkdown({
          filename: file.filename,
          content: file.content,
        })
      );
    } catch (err) {
      errors.push({
        filename: file.filename,
        error: err instanceof Error ? err.message : "import failed",
      });
    }
  }

  return Response.json({ imported, errors });
}
