import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkDataPermissions, fixDataPermissions } from "../../bin/lib/data-permissions.mjs";

const tempDirs: string[] = [];

function tempDir() {
  const dir = fs.mkdtempSync(join(tmpdir(), "employee001-permissions-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("data permissions", () => {
  it("finds readable data and fixes real paths", () => {
    const data = join(tempDir(), "data");
    const employee = join(data, "employees", "ada");
    fs.mkdirSync(employee, { recursive: true, mode: 0o755 });
    const profile = join(employee, "employee.json");
    fs.writeFileSync(profile, "{}", { mode: 0o644 });
    fs.chmodSync(data, 0o755);

    expect(checkDataPermissions(data).insecure).toEqual(expect.arrayContaining([data, profile]));
    expect(fixDataPermissions(data).changed).toBeGreaterThan(0);
    expect(fs.statSync(data).mode & 0o777).toBe(0o700);
    expect(fs.statSync(profile).mode & 0o777).toBe(0o600);
    expect(checkDataPermissions(data).insecure).toEqual([]);
  });

  it("does not follow symlinks while fixing", () => {
    const root = tempDir();
    const data = join(root, "data");
    const outside = join(root, "outside.txt");
    fs.mkdirSync(data);
    fs.writeFileSync(outside, "keep public", { mode: 0o644 });
    fs.symlinkSync(outside, join(data, "linked.txt"));

    fixDataPermissions(data);
    expect(fs.statSync(outside).mode & 0o777).toBe(0o644);
  });
});
