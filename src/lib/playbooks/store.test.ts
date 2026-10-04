import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createCustomPlaybook,
  deleteCustomPlaybook,
  getPlaybook,
  listPlaybooks,
  updateCustomPlaybook,
} from "./store";

let directory: string;
const priorHome = process.env.EMPLOYEE001_HOME;
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "employee001-playbooks-"));
  process.env.EMPLOYEE001_HOME = directory;
});
afterEach(() => {
  fs.rmSync(directory, { recursive: true, force: true });
  if (priorHome === undefined) delete process.env.EMPLOYEE001_HOME;
  else process.env.EMPLOYEE001_HOME = priorHome;
});

const input = {
  name: "Custom brief",
  description: "Test",
  icon: "note",
  participants: "all" as const,
  mode: "single" as const,
  inputs: [],
  context: [],
  prompt: "Return JSON",
  outputSchema: "brief" as const,
  sinks: [],
  budgetUsd: 0.1,
};
describe("playbook store", () => {
  it("keeps built-ins immutable and persists custom playbooks", () => {
    expect(
      listPlaybooks().find((playbook) => playbook.kind === "builtin")?.id,
    ).toBe("example-brief");
    const created = createCustomPlaybook(input);
    expect(getPlaybook(created.id)).toMatchObject({
      kind: "custom",
      name: "Custom brief",
    });
    expect(updateCustomPlaybook(created.id, { name: "Edited" })?.name).toBe(
      "Edited",
    );
    expect(deleteCustomPlaybook(created.id)).toBe(true);
    expect(getPlaybook(created.id)).toBeUndefined();
  });
});
