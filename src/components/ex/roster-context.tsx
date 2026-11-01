"use client";

// Client-side roster cache. The Shell layout fetches /api/employees on mount
// and exposes the result via context so individual components
// (employee-picker, global-approval-overlay, etc.) don't each
// duplicate the network call. Falls back to the empty in-memory constant
// from `@/lib/employees` while loading or on fetch failure, matching the
// disk-roster refactor's "empty on first paint, hydrate from API" pattern.
//
// Because the fallback is empty, "no twins" is ambiguous until the fetch
// settles: read `useRosterLoaded()` before showing an empty state.
//
// The shell stays mounted across client-side navigation, so a page that
// changes the roster (retiring a twin on /handover, say) calls
// `refreshRoster()` afterwards; otherwise other pages keep the old copy
// until a reload.

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { EMPLOYEES_WITH_TWIN, type EmployeeWithTwin } from "@/lib/employees";
import { fetchRoster } from "./roster-load";

const RosterContext = createContext<EmployeeWithTwin[]>(EMPLOYEES_WITH_TWIN);
const RosterLoadedContext = createContext<boolean>(false);
const RefreshRosterContext = createContext<() => void>(() => {});

export function RosterProvider({ children }: { children: ReactNode }) {
  const [roster, setRoster] = useState<EmployeeWithTwin[]>(EMPLOYEES_WITH_TWIN);
  const [loaded, setLoaded] = useState(false);
  // Bumped by refreshRoster(); each bump refetches, and a newer fetch wins.
  const [version, setVersion] = useState(0);

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
  }, [version]);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  return (
    <RefreshRosterContext.Provider value={refresh}>
      <RosterLoadedContext.Provider value={loaded}>
        <RosterContext.Provider value={roster}>{children}</RosterContext.Provider>
      </RosterLoadedContext.Provider>
    </RefreshRosterContext.Provider>
  );
}

export function useRoster(): EmployeeWithTwin[] {
  return useContext(RosterContext);
}

/** False until the first roster request has settled (success or failure). */
export function useRosterLoaded(): boolean {
  return useContext(RosterLoadedContext);
}

/** Refetch the shared roster after a change to a twin (retire, delete, ...). */
export function useRefreshRoster(): () => void {
  return useContext(RefreshRosterContext);
}
