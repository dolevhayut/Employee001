import { chmodSync, existsSync, lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";

const PRIVATE_BITS = 0o077;

function isInsecure(path) {
  return (lstatSync(path).mode & PRIVATE_BITS) !== 0;
}

/** Check data/ and the files immediately inside each employee directory. */
export function checkDataPermissions(dataDir) {
  const insecure = [];
  if (!existsSync(dataDir)) return { insecure };

  const root = lstatSync(dataDir);
  if ((root.mode & PRIVATE_BITS) !== 0) insecure.push(dataDir);

  const employees = join(dataDir, "employees");
  if (!existsSync(employees) || lstatSync(employees).isSymbolicLink()) return { insecure };
  for (const employee of readdirSync(employees, { withFileTypes: true })) {
    if (!employee.isDirectory() || employee.isSymbolicLink()) continue;
    const employeeDir = join(employees, employee.name);
    for (const entry of readdirSync(employeeDir, { withFileTypes: true })) {
      if (!entry.isFile() || entry.isSymbolicLink()) continue;
      const path = join(employeeDir, entry.name);
      if (isInsecure(path)) insecure.push(path);
    }
  }
  return { insecure };
}

/** Make all real directories and files below dataDir private without following links. */
export function fixDataPermissions(dataDir) {
  if (!existsSync(dataDir)) return { changed: 0 };
  let changed = 0;
  const visit = (path) => {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) return;
    const targetMode = stat.isDirectory() ? 0o700 : stat.isFile() ? 0o600 : null;
    if (targetMode !== null && (stat.mode & 0o777) !== targetMode) {
      chmodSync(path, targetMode);
      changed++;
    }
    if (stat.isDirectory()) {
      for (const entry of readdirSync(path, { withFileTypes: true })) visit(join(path, entry.name));
    }
  };
  visit(dataDir);
  return { changed };
}
