import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  KNOWLEDGE_LINEAGE_SOURCE,
  approxResultTokens,
  buildTwinLineage,
  lineageSourceForTool,
  parseTwinLineage,
  recordLineageRead,
  type LineageTally,
} from "./twin-builder-lineage";

describe("lineageSourceForTool", () => {
  const active = ["github", "google", "googlecalendar", "gmail"];

  it("maps a Composio action to its toolkit, longest slug first", () => {
    expect(lineageSourceForTool("mcp__composio__GITHUB_LIST_PULL_REQUESTS", active, [])).toEqual({ toolkit: "github", itemType: "items read" });
    expect(lineageSourceForTool("mcp__composio__GOOGLECALENDAR_LIST_EVENTS", active, [])?.toolkit).toBe("googlecalendar");
  });

  it("maps an org MCP tool to its server", () => {
    expect(lineageSourceForTool("mcp__company_wiki__search", [], ["company_wiki"])?.toolkit).toBe("company_wiki");
  });

  it("ignores built-ins, Composio meta tools and unknown servers", () => {
    expect(lineageSourceForTool("Read", active, [])).toBeNull();
    expect(lineageSourceForTool("mcp__composio__COMPOSIO_SEARCH_TOOLS", active, [])).toBeNull();
    expect(lineageSourceForTool("mcp__other__search", active, ["company_wiki"])).toBeNull();
  });
});

describe("buildTwinLineage", () => {
  const startedAt = new Date("2026-11-03T10:00:00.000Z");
  const finishedAt = new Date("2026-11-03T10:20:00.000Z");

  it("returns null when the build read nothing", () => {
    expect(buildTwinLineage({ tally: new Map(), lookbackDays: 90, startedAt, finishedAt })).toBeNull();
  });

  it("totals reads per source over the lookback window", () => {
    const tally: LineageTally = new Map();
    recordLineageRead(tally, { toolkit: "gmail", itemType: "items read" }, "x".repeat(4000));
    recordLineageRead(tally, { toolkit: "gmail", itemType: "items read" }, [{ type: "text", text: "y".repeat(400) }]);
    recordLineageRead(tally, KNOWLEDGE_LINEAGE_SOURCE, "");
    const lineage = buildTwinLineage({ tally, lookbackDays: 90, startedAt, finishedAt });
    expect(lineage).not.toBeNull();
    expect(lineage!.sources.map((s) => [s.toolkit, s.count, s.tokens])).toEqual([
      ["gmail", 2, 1100],
      ["knowledge", 1, 1],
    ]);
    expect(lineage!.totalTokens).toBe(1101);
    expect(lineage!.lastSyncAt).toBe(finishedAt.toISOString());
    expect(lineage!.sources[0].fromDate).toBe("2026-08-05T10:00:00.000Z");
    expect(lineage!.sources[0].toDate).toBe(finishedAt.toISOString());
    // Round-trips through the on-disk validator unchanged.
    expect(parseTwinLineage(JSON.parse(JSON.stringify(lineage)))).toEqual(lineage);
  });

  it("gives every read at least one token so the card never divides by zero", () => {
    expect(approxResultTokens(undefined)).toBe(1);
    expect(approxResultTokens("abcdefgh")).toBe(2);
  });
});

describe("parseTwinLineage", () => {
  it("rejects malformed or empty records", () => {
    expect(parseTwinLineage(undefined)).toBeUndefined();
    expect(parseTwinLineage({ totalTokens: 0, lastSyncAt: "2026-11-03T10:00:00Z", sources: [] })).toBeUndefined();
    expect(parseTwinLineage({ totalTokens: 5, lastSyncAt: "2026-11-03T10:00:00Z", sources: [{ toolkit: "gmail" }] })).toBeUndefined();
  });
});

describe("lineage on employee.json", () => {
  let home: string;
  const ID = "noa-1a2b3c";
  const sidecar = () => path.join(home, "data", "employees", ID, "employee.json");

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "employee001-lineage-"));
    process.env.EMPLOYEE001_HOME = home;
    vi.resetModules();
    fs.mkdirSync(path.dirname(sidecar()), { recursive: true });
    fs.writeFileSync(sidecar(), JSON.stringify({ id: ID, name: "Noa Friedman", role: "PM" }));
  });

  afterEach(() => {
    delete process.env.EMPLOYEE001_HOME;
    fs.rmSync(home, { recursive: true, force: true });
  });

  const lineage = () => {
    const tally: LineageTally = new Map();
    recordLineageRead(tally, { toolkit: "slack", itemType: "items read" }, "z".repeat(800));
    return buildTwinLineage({
      tally,
      lookbackDays: 30,
      startedAt: new Date("2026-11-03T10:00:00.000Z"),
      finishedAt: new Date("2026-11-03T10:05:00.000Z"),
    })!;
  };

  it("is saved after a build and served on the employee record", async () => {
    const { saveTwinLineage, loadEmployeesFromDisk } = await import("./employees-disk");
    expect(await saveTwinLineage(ID, lineage())).toBe(true);
    const stored = JSON.parse(fs.readFileSync(sidecar(), "utf8"));
    expect(stored.name).toBe("Noa Friedman");
    expect(stored.lineage.sources[0].toolkit).toBe("slack");
    const [employee] = await loadEmployeesFromDisk();
    expect(employee.lineage).toEqual(lineage());
  });

  it("leaves a retired twin's record alone", async () => {
    fs.writeFileSync(sidecar(), JSON.stringify({ id: ID, name: "Noa Friedman", lifecycle: "retired" }));
    const { saveTwinLineage } = await import("./employees-disk");
    expect(await saveTwinLineage(ID, lineage())).toBe(false);
    expect(JSON.parse(fs.readFileSync(sidecar(), "utf8")).lineage).toBeUndefined();
  });
});
