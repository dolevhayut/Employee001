// Serializes read-modify-write updates to one employee's employee.json
// sidecar within this server process, so two writers (e.g. the activity
// counter and a profile edit) can't interleave and drop each other's fields.

import "server-only";

const chains = new Map<string, Promise<unknown>>();

export function withSidecarLock<T>(employeeId: string, fn: () => Promise<T>): Promise<T> {
  const previous = chains.get(employeeId) ?? Promise.resolve();
  const run = previous.then(fn, fn);
  const settled = run.catch(() => undefined);
  chains.set(employeeId, settled);
  void settled.then(() => {
    if (chains.get(employeeId) === settled) chains.delete(employeeId);
  });
  return run;
}
