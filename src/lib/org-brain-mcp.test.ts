import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/meeting-memory", () => ({ searchMeetings: vi.fn(async () => []) }));
vi.mock("@/lib/org-brain-search", () => ({ searchOrgBrain: vi.fn(async () => []) }));

const { buildOrgBrainMcpServer } = await import("./org-brain-mcp");

const toolNames = (server: ReturnType<typeof buildOrgBrainMcpServer>) =>
  Object.keys((server.instance as unknown as { _registeredTools: Record<string, unknown> })._registeredTools).sort();

describe("buildOrgBrainMcpServer", () => {
  it("offers search_meetings only when the run belongs to a twin inside the workspace", () => {
    expect(toolNames(buildOrgBrainMcpServer())).toEqual(["search_org_brain"]);
    expect(toolNames(buildOrgBrainMcpServer({ meetingsFor: "noa" }))).toEqual(["search_meetings", "search_org_brain"]);
  });
});
