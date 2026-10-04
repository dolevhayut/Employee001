import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  deleteKnowledgeFile,
  readKnowledgeFile,
  saveUploadedKnowledgeFile,
  writeKnowledgeFile,
} from "./knowledge-files";
import {
  listKnowledgeVersions,
  listRecentlyDeletedKnowledge,
  readKnowledgeVersion,
  restoreKnowledgeVersion,
} from "./knowledge-versions";

const EXTRACTED_MARKER = "<!-- employee001:extracted -->";

let previousCwd: string;
let tempDir: string;

beforeEach(() => {
  previousCwd = process.cwd();
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "e086b-knowledge-"));
  process.chdir(tempDir);
});

afterEach(() => {
  process.chdir(previousCwd);
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function logEntries(employeeId = "twin-a"): Array<{
  ts: string;
  name: string;
  sizeBytes: number;
  source: string;
}> {
  const segment = employeeId === "Bob Smith" ? "Bob-Smith" : employeeId;
  const logPath = path.join(
    tempDir,
    "data",
    "employees",
    segment,
    ".versions",
    "knowledge",
    "_log.jsonl",
  );
  if (!fs.existsSync(logPath)) return [];
  return fs
    .readFileSync(logPath, "utf-8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as {
      ts: string;
      name: string;
      sizeBytes: number;
      source: string;
    });
}

describe("knowledge file versions", () => {
  it("does not snapshot the first write of a text file", () => {
    writeKnowledgeFile("twin-a", "notes.md", "hello");
    expect(listKnowledgeVersions("twin-a", "notes.md")).toEqual([]);
    expect(logEntries()).toEqual([]);
  });

  it("snapshots the previous body before an edit, newest first", () => {
    writeKnowledgeFile("twin-a", "notes.md", "שלום");
    writeKnowledgeFile("twin-a", "notes.md", "second");
    writeKnowledgeFile("twin-a", "notes.md", "third");

    const versions = listKnowledgeVersions("twin-a", "notes.md");
    expect(versions.map((entry) => entry.source)).toEqual(["edit", "edit"]);
    expect(readKnowledgeVersion("twin-a", "notes.md", versions[0].ts)).toBe("second");
    expect(readKnowledgeVersion("twin-a", "notes.md", versions[1].ts)).toBe("שלום");
    expect(versions[1].sizeBytes).toBe(Buffer.byteLength("שלום", "utf-8"));

    const stored = logEntries();
    expect(Object.keys(stored[0])).toEqual(["ts", "name", "sizeBytes", "source"]);
    expect(stored[0]).toMatchObject({ name: "notes.md", source: "edit" });
    expect(stored[0].ts).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z(?:-\d+)?$/,
    );

    const snapDir = path.join(
      tempDir,
      "data",
      "employees",
      "twin-a",
      ".versions",
      "knowledge",
      "notes.md",
    );
    expect(fs.readdirSync(snapDir).sort()).toEqual(
      stored.map((entry) => `${entry.ts}.md`).sort(),
    );
  });

  it("snapshots an existing empty file before it is overwritten", () => {
    writeKnowledgeFile("twin-a", "notes.md", "");
    writeKnowledgeFile("twin-a", "notes.md", "now filled");
    const versions = listKnowledgeVersions("twin-a", "notes.md");
    expect(versions).toHaveLength(1);
    expect(readKnowledgeVersion("twin-a", "notes.md", versions[0].ts)).toBe("");
  });

  it("keeps the last 50 snapshots per file and leaves other files alone", () => {
    writeKnowledgeFile("twin-a", "other.txt", "keep-me");
    writeKnowledgeFile("twin-a", "other.txt", "keep-me-2");
    writeKnowledgeFile("twin-a", "notes.md", "v0");
    for (let i = 1; i <= 51; i += 1) {
      writeKnowledgeFile("twin-a", "notes.md", `v${i}`);
    }

    const versions = listKnowledgeVersions("twin-a", "notes.md");
    expect(versions).toHaveLength(50);
    expect(readKnowledgeVersion("twin-a", "notes.md", versions[0].ts)).toBe("v50");
    expect(readKnowledgeVersion("twin-a", "notes.md", versions[49].ts)).toBe("v1");
    expect(versions.map((entry) => readKnowledgeVersion("twin-a", "notes.md", entry.ts))).not.toContain(
      "v0",
    );

    const snapDir = path.join(
      tempDir,
      "data",
      "employees",
      "twin-a",
      ".versions",
      "knowledge",
      "notes.md",
    );
    expect(fs.readdirSync(snapDir)).toHaveLength(50);

    const others = logEntries().filter((entry) => entry.name === "other.txt");
    expect(others).toHaveLength(1);
    expect(readKnowledgeVersion("twin-a", "other.txt", others[0].ts)).toBe("keep-me");
    expect(readKnowledgeFile("twin-a", "notes.md")?.body).toBe("v51");
  });

  it("snapshots a text file before delete and can restore it after the file is gone", () => {
    writeKnowledgeFile("twin-a", "notes.md", "bring me back");
    expect(deleteKnowledgeFile("twin-a", "notes.md")).toBe(true);
    expect(readKnowledgeFile("twin-a", "notes.md")).toBeNull();

    const deleted = listRecentlyDeletedKnowledge("twin-a");
    expect(deleted).toEqual([
      expect.objectContaining({
        name: "notes.md",
        source: "delete",
        sizeBytes: Buffer.byteLength("bring me back", "utf-8"),
      }),
    ]);
    expect(readKnowledgeVersion("twin-a", "notes.md", deleted[0].ts)).toBe("bring me back");

    const restored = restoreKnowledgeVersion("twin-a", "notes.md", deleted[0].ts);
    expect(restored).toEqual({ ok: true });
    expect(readKnowledgeFile("twin-a", "notes.md")?.body).toBe("bring me back");
    expect(listRecentlyDeletedKnowledge("twin-a")).toEqual([]);
  });

  it("snapshots the live body on restore so the restore can be undone", () => {
    writeKnowledgeFile("twin-a", "data.csv", "a");
    writeKnowledgeFile("twin-a", "data.csv", "b");
    const before = listKnowledgeVersions("twin-a", "data.csv");
    expect(before).toHaveLength(1);

    expect(restoreKnowledgeVersion("twin-a", "data.csv", before[0].ts)).toEqual({ ok: true });
    expect(readKnowledgeFile("twin-a", "data.csv")?.body).toBe("a");

    const after = listKnowledgeVersions("twin-a", "data.csv");
    expect(after[0].source).toBe("restore");
    expect(readKnowledgeVersion("twin-a", "data.csv", after[0].ts)).toBe("b");

    expect(restoreKnowledgeVersion("twin-a", "data.csv", after[0].ts)).toEqual({ ok: true });
    expect(readKnowledgeFile("twin-a", "data.csv")?.body).toBe("b");
  });

  it("does not snapshot a pdf, but does snapshot its extracted markdown companion on delete", () => {
    const saved = saveUploadedKnowledgeFile("twin-a", "spec.pdf", Buffer.from("%PDF-1.1"));
    expect(saved).toMatchObject({ name: "spec.pdf" });
    const dir = path.join(tempDir, "data", "employees", "twin-a", "knowledge");
    fs.writeFileSync(
      path.join(dir, "spec.pdf.md"),
      `${EXTRACTED_MARKER}\n\nHello from the pdf\n`,
      "utf-8",
    );

    expect(deleteKnowledgeFile("twin-a", "spec.pdf")).toBe(true);
    expect(fs.existsSync(path.join(dir, "spec.pdf"))).toBe(false);
    expect(fs.existsSync(path.join(dir, "spec.pdf.md"))).toBe(false);
    expect(
      fs.existsSync(
        path.join(tempDir, "data", "employees", "twin-a", ".versions", "knowledge", "spec.pdf"),
      ),
    ).toBe(false);

    const versions = listKnowledgeVersions("twin-a", "spec.pdf.md");
    expect(versions.map((entry) => entry.source)).toEqual(["delete"]);
    expect(readKnowledgeVersion("twin-a", "spec.pdf.md", versions[0].ts)).toContain(
      "Hello from the pdf",
    );
  });

  it("leaves a user-written markdown file alone when its pdf namesake is deleted", () => {
    writeKnowledgeFile("twin-a", "spec.pdf.md", "my own notes");
    saveUploadedKnowledgeFile("twin-a", "spec.pdf", Buffer.from("%PDF-1.1"));
    expect(deleteKnowledgeFile("twin-a", "spec.pdf")).toBe(true);
    expect(readKnowledgeFile("twin-a", "spec.pdf.md")?.body).toBe("my own notes");
    expect(listKnowledgeVersions("twin-a", "spec.pdf.md")).toEqual([]);
  });

  it("rejects path traversal and unknown versions", () => {
    writeKnowledgeFile("twin-a", "notes.md", "safe");
    writeKnowledgeFile("twin-a", "notes.md", "safer");
    const ts = listKnowledgeVersions("twin-a", "notes.md")[0].ts;

    expect(writeKnowledgeFile("twin-a", "../secrets.md", "nope")).toBeNull();
    expect(writeKnowledgeFile("twin-a", "nested/notes.md", "nope")).toBeNull();
    expect(readKnowledgeVersion("twin-a", "../notes.md", ts)).toBeNull();
    expect(readKnowledgeVersion("twin-a", "notes.md", "../etc")).toBeNull();
    expect(readKnowledgeVersion("twin-a", "notes.md", `${ts}/../../x`)).toBeNull();
    expect(restoreKnowledgeVersion("twin-a", "notes.md", "not-a-timestamp")).toEqual({
      ok: false,
      error: "version not found",
    });
    expect(fs.existsSync(path.join(tempDir, "secrets.md"))).toBe(false);
    expect(readKnowledgeFile("Bob Smith", "notes.md")).toBeNull();
  });

  it("stores snapshots beside the sanitized employee id", () => {
    writeKnowledgeFile("Bob Smith", "notes.md", "one");
    writeKnowledgeFile("Bob Smith", "notes.md", "two");
    const versions = listKnowledgeVersions("Bob Smith", "notes.md");
    expect(readKnowledgeVersion("Bob Smith", "notes.md", versions[0].ts)).toBe("one");
    expect(
      fs.existsSync(
        path.join(
          tempDir,
          "data",
          "employees",
          "Bob-Smith",
          ".versions",
          "knowledge",
          "notes.md",
          `${versions[0].ts}.md`,
        ),
      ),
    ).toBe(true);
  });

  it("shows only the latest delete for a name that is still gone", () => {
    writeKnowledgeFile("twin-a", "notes.md", "first");
    deleteKnowledgeFile("twin-a", "notes.md");
    writeKnowledgeFile("twin-a", "notes.md", "second");
    deleteKnowledgeFile("twin-a", "notes.md");
    writeKnowledgeFile("twin-a", "kept.md", "stay");
    deleteKnowledgeFile("twin-a", "kept.md");

    const deleted = listRecentlyDeletedKnowledge("twin-a");
    expect(deleted.map((entry) => entry.name)).toEqual(["kept.md", "notes.md"]);
    const notes = deleted.find((entry) => entry.name === "notes.md");
    expect(notes).toBeDefined();
    expect(readKnowledgeVersion("twin-a", "notes.md", notes!.ts)).toBe("second");
  });
});
