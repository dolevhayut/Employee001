// Every test file starts in its own empty folder, which is the app home when
// EMPLOYEE001_HOME is unset. Paths like the audit log are fixed when a module
// loads, before a test's beforeEach can point EMPLOYEE001_HOME somewhere else,
// so without this the tests wrote into the checkout's real data/ folder.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll } from "vitest";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "e001-test-home-"));
const repo = process.cwd();
delete process.env.EMPLOYEE001_HOME;
delete process.env.EMPLOYEE001_ENV_FILE;
process.env.EMPLOYEE001_CONNECTOR_CONTRACTS ??= path.join(repo, "evals", "connectors", "contracts");
process.chdir(home);
afterAll(() => {
  process.chdir(repo);
  fs.rmSync(home, { recursive: true, force: true });
});
