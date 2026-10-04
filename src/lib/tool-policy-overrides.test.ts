import fs from "fs/promises";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";

import {
  clearToolPolicyOverride,
  getToolPolicyOverrides,
  setToolPolicyOverride,
} from "./tool-policy-overrides";

const employeeIds: string[] = [];

function employeeId(): string {
  const id = `tool-policy-test-${crypto.randomUUID()}`;
  employeeIds.push(id);
  return id;
}

afterEach(async () => {
  await Promise.all(employeeIds.splice(0).map((id) =>
    fs.rm(path.join(process.cwd(), "data", "employees", id), { recursive: true, force: true }),
  ));
});

describe("tool-policy overrides", () => {
  it("persists a per-employee override without sharing it with another employee", async () => {
    const first = employeeId();
    const second = employeeId();
    await setToolPolicyOverride(first, "GITHUB_CREATE_AN_ISSUE", "allow");

    await expect(getToolPolicyOverrides(first)).resolves.toEqual({
      GITHUB_CREATE_AN_ISSUE: "allow",
    });
    await expect(getToolPolicyOverrides(second)).resolves.toEqual({});
  });

  it("serializes concurrent updates and supports clearing an override", async () => {
    const id = employeeId();
    await Promise.all([
      setToolPolicyOverride(id, "GITHUB_CREATE_AN_ISSUE", "allow"),
      setToolPolicyOverride(id, "SLACK_SEND_MESSAGE", "ask"),
    ]);
    expect(await getToolPolicyOverrides(id)).toEqual({
      GITHUB_CREATE_AN_ISSUE: "allow",
      SLACK_SEND_MESSAGE: "ask",
    });

    await clearToolPolicyOverride(id, "GITHUB_CREATE_AN_ISSUE");
    expect(await getToolPolicyOverrides(id)).toEqual({ SLACK_SEND_MESSAGE: "ask" });
  });
});
