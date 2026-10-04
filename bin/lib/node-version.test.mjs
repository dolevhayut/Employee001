import assert from "node:assert/strict";
import test from "node:test";
import { checkNodeVersion } from "./node-version.mjs";

for (const version of ["22.0.0", "v22.12.0", "24.0.0", "24.12.0"]) {
  test(`accepts supported Node ${version}`, () => {
    assert.deepEqual(checkNodeVersion(version), {
      ok: true,
      level: "ok",
      message: `Node ${Number(version.replace(/^v/, "").split(".")[0])} is supported`,
    });
  });
}

for (const version of ["23.0.0", "25.0.0", "26.0.0"]) {
  test(`warns for unsupported Node ${version}`, () => {
    const major = Number(version.split(".")[0]);
    assert.deepEqual(checkNodeVersion(version), {
      ok: true,
      level: "warn",
      message: `Node ${major} is not supported yet (native modules); use Node 24 LTS, e.g. \`nvm install 24 && nvm use 24\``,
    });
  });
}

test("rejects Node versions below 22", () => {
  assert.deepEqual(checkNodeVersion("21.7.3"), {
      ok: false,
      level: "error",
      message: "Node 21 is too old; use Node 24 LTS",
  });
});
