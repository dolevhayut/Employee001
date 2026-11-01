"use client";

// Client-side roster cache. The Shell layout fetches /api/employees once on
// mount and exposes the result via context so individual components
// (employee-picker, global-approval-overlay, etc.) don't each
// duplicate the network call. Falls back to the empty in-memory constant
// from `@/lib/employees` while loading or on fetch failure, matching the
// disk-roster refactor's "empty on first paint, hydrate from API" pattern.
//
// Because the fallback is empty, "no twins" is ambiguous until the fetch
// settles: read `useRosterLoaded()` before showing an empty state.

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { EMPLOYEES_WITH_TWIN, type EmployeeWithTwin } from "@/lib/employees";
import { fetchRoster } from "./roster-load";

const RosterContext = createContext<EmployeeWithTwin[]>(EMPLOYEES_WITH_TWIN);
const RosterLoadedContext = createContext<boolean>(false);

export function RosterProvider({ children }: { children: ReactNode }) {
  const [roster, setRoster] = useState<EmployeeWithTwin[]>(EMPLOYEES_WITH_TWIN);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetchRoster().then((data) => {
      if (cancelled) return;
      if (data) setRoster(data); // otherwise keep the fallback
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <RosterLoadedContext.Provider value={loaded}>
      <RosterContext.Provider value={roster}>{children}</RosterContext.Provider>
    </RosterLoadedContext.Provider>
  );
}

export function useRoster(): EmployeeWithTwin[] {
  return useContext(RosterContext);
}

/** False until the roster request has settled (success or failure). */
export function useRosterLoaded(): boolean {
  return useContext(RosterLoadedContext);
}
