"use client";

// Client-side roster cache. The Shell layout fetches /api/employees once on
// mount and exposes the result via context so individual components
// (twin-chat-pane, employee-picker, global-approval-overlay, etc.) don't each
// duplicate the network call. Falls back to the empty in-memory constant
// from `@/lib/employees` while loading or on fetch failure, matching the
// disk-roster refactor's "empty on first paint, hydrate from API" pattern.

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { EMPLOYEES_WITH_TWIN, type EmployeeWithTwin } from "@/lib/employees";

const RosterContext = createContext<EmployeeWithTwin[]>(EMPLOYEES_WITH_TWIN);

export function RosterProvider({ children }: { children: ReactNode }) {
  const [roster, setRoster] = useState<EmployeeWithTwin[]>(EMPLOYEES_WITH_TWIN);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/employees")
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled && Array.isArray(data)) setRoster(data as EmployeeWithTwin[]);
      })
      .catch(() => {
        /* keep fallback */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return <RosterContext.Provider value={roster}>{children}</RosterContext.Provider>;
}

export function useRoster(): EmployeeWithTwin[] {
  return useContext(RosterContext);
}
