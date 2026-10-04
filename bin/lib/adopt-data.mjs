import * as nodeFs from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** @typedef {{ readdirSync: Function, existsSync: Function, statSync: Function, mkdirSync: Function, cpSync: Function }} AdoptFs */

/** @param {string} dataDir @param {AdoptFs} fs */
function employeeCandidate(dataDir, fs) {
  const employeesDir = join(dataDir, "employees");
  try {
    const hasTwin = fs.readdirSync(employeesDir, { withFileTypes: true }).some((entry) =>
      entry.isDirectory() && fs.existsSync(join(employeesDir, entry.name, "employee.json")),
    );
    if (!hasTwin) return {};
    return { candidate: { dataDir, mtimeMs: fs.statSync(employeesDir).mtimeMs } };
  } catch (error) {
    return error?.code === "ENOENT" ? {} : { warning: error };
  }
}

/**
 * Copy twins stranded by older standalone installs into the user's data dir.
 * File-system and home-dir dependencies are injectable so this remains testable.
 * @param {{ home: string, pkgRoot: string, env?: Record<string, string | undefined>, fs?: AdoptFs, homeDir?: () => string, npmCache?: string }} options
 */
export function adoptData({
  home,
  pkgRoot,
  env = process.env,
  fs = nodeFs,
  homeDir = homedir,
  npmCache,
} = {}) {
  if (env.EMPLOYEE001_DEMO === "1") return { adopted: false };

  const targetData = join(home, "data");
  if (employeeCandidate(targetData, fs).candidate) return { adopted: false };

  const candidates = [];
  const warnings = [];
  const addCandidate = (dataDir) => {
    const { candidate, warning } = employeeCandidate(dataDir, fs);
    if (candidate) candidates.push(candidate);
    if (warning) warnings.push(warning);
  };
  addCandidate(join(pkgRoot, ".next", "standalone", "data"));

  const cache = npmCache ?? env.npm_config_cache ?? join(homeDir(), ".npm");
  const npxRoot = join(cache, "_npx");
  try {
    for (const entry of fs.readdirSync(npxRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dataDir = join(npxRoot, entry.name, "node_modules", "employee001", ".next", "standalone", "data");
      addCandidate(dataDir);
    }
  } catch (error) {
    // A missing npm cache is expected; permission errors are non-fatal too.
    if (error?.code !== "ENOENT") warnings.push(error);
  }

  const source = candidates.reduce(
    (newest, candidate) => (!newest || candidate.mtimeMs > newest.mtimeMs ? candidate : newest),
    null,
  );
  if (!source) return { adopted: false, ...(warnings[0] ? { warning: warnings[0] } : {}) };

  try {
    fs.mkdirSync(targetData, { recursive: true });
    fs.cpSync(source.dataDir, targetData, { recursive: true, force: false, errorOnExist: false });
    return { adopted: true, source: source.dataDir, target: targetData, ...(warnings[0] ? { warning: warnings[0] } : {}) };
  } catch (warning) {
    return { adopted: false, warning };
  }
}

/** @param {string} dataDir @param {AdoptFs} [fs] */
export function countTwins(dataDir, fs = nodeFs) {
  try {
    return fs.readdirSync(join(dataDir, "employees"), { withFileTypes: true }).filter((entry) =>
      entry.isDirectory() && fs.existsSync(join(dataDir, "employees", entry.name, "employee.json")),
    ).length;
  } catch {
    return 0;
  }
}
