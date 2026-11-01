// Load-state helpers for the client roster and the Autonomy toggle. Both
// providers start from an empty / "base" fallback before the server answers;
// an empty or "off" state may only be shown once the data has actually
// arrived, otherwise the UI flashes "No trained twin yet" / "Autonomy off"
// on every page load. Kept free of React so the logic is unit-testable.

import type { EmployeeWithTwin } from "@/lib/employees";
import type { WorkspaceMode } from "@/lib/workspace-mode";

/** Fetch the roster. Resolves with the array, or null when the response is
 *  not an array or the request failed. Never rejects, so the caller can
 *  always mark the roster as loaded once it settles. */
export async function fetchRoster(
  fetchImpl: typeof fetch = fetch,
): Promise<EmployeeWithTwin[] | null> {
  try {
    // no-store: a refresh after a retire must not get the cached copy back.
    const res = await fetchImpl("/api/employees", { cache: "no-store" });
    const data: unknown = await res.json();
    return Array.isArray(data) ? (data as EmployeeWithTwin[]) : null;
  } catch {
    return null;
  }
}

/** What a page that needs a trained twin should show. */
export function twinsGate(loaded: boolean, readyCount: number): "loading" | "empty" | "ready" {
  if (!loaded) return "loading";
  return readyCount === 0 ? "empty" : "ready";
}

/** What the sidebar Autonomy toggle should show. */
export function autonomyGate(loaded: boolean, mode: WorkspaceMode): "loading" | "armed" | "off" {
  if (!loaded) return "loading";
  return mode === "x" ? "armed" : "off";
}
