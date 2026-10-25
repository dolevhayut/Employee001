import { describe, expect, it } from "vitest";
import { buildBuilderSystemPrompt, hasBuildMaterial } from "./twin-builder";
import { TWIN_FILE_NAMES } from "./twin-builder-types";

const baseEmployee = {
  id: "emp-1",
  name: "Ava Chen",
  firstName: "Ava",
  role: "Head of Success",
} as import("@/lib/employees").EmployeeWithTwin;

describe("buildBuilderSystemPrompt", () => {
  it("pins generatedAt and asks for knowledge/ paths in sources", () => {
    const generatedAt = "2026-10-25T21:30:45.123Z";
    const prompt = buildBuilderSystemPrompt({
      employee: baseEmployee,
      employeeDir: "/data/employees/emp-1",
      activeToolkits: [],
      orgMcpNames: [],
      materialFiles: ["notes.md", "playbook.pdf"],
      materialFolders: [],
      existingFiles: [...TWIN_FILE_NAMES],
      lookbackDays: 90,
      generatedAt,
    });

    expect(prompt).toContain(`generatedAt: ${generatedAt}`);
    expect(prompt).toContain("do not invent a timestamp or round to midnight");
    expect(prompt).toContain("knowledge/<filename>");
    expect(prompt).toContain("`knowledge/notes.md`");
    expect(prompt).toContain("`knowledge/playbook.pdf`");
  });

  it("treats configured folders as readable build material", () => {
    const prompt = buildBuilderSystemPrompt({ employee: baseEmployee, employeeDir: "/data/employees/emp-1", activeToolkits: [], orgMcpNames: [], materialFiles: [], materialFolders: [{ path: "/work/docs", label: "Product docs", addedAt: "2026-10-25T00:00:00.000Z" }], existingFiles: [], lookbackDays: 90, generatedAt: "2026-10-25T21:30:45.123Z" });
    expect(prompt).toContain("Configured local folders");
    expect(prompt).toContain("Product docs");
    expect(prompt).toContain("/work/docs");
  });

  it("counts a configured folder as build material without documents or tools", () => {
    expect(hasBuildMaterial([], [{ path: "/work/docs", label: "Product docs", addedAt: "2026-10-25T00:00:00.000Z" }])).toBe(true);
  });
});
