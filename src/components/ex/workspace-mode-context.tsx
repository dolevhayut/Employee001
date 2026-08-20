"use client";

// Client-side cache of the workspace operation mode (the EmployeeX toggle).
// Same pattern as roster-context: Shell fetches once on mount, components
// read via context, and the toggle PATCHes then updates optimistically.
// Falls back to "base" while loading — the safe default (autonomy disarmed,
// X-only surfaces hidden) so nothing flashes in and then disappears.

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import type { WorkspaceMode } from "@/lib/workspace-mode";

type WorkspaceModeValue = {
  mode: WorkspaceMode;
  /** False until the server value has arrived — the toggle disables itself
   *  during this window so a click can't race the initial GET. */
  loaded: boolean;
  setMode: (mode: WorkspaceMode) => void;
};

const WorkspaceModeContext = createContext<WorkspaceModeValue>({
  mode: "base",
  loaded: false,
  setMode: () => {},
});

export function WorkspaceModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<WorkspaceMode>("base");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/system/mode")
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data?.mode === "x" || data?.mode === "base") setModeState(data.mode);
        setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setLoaded(true); // keep "base" fallback
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setMode = useCallback((next: WorkspaceMode) => {
    setModeState(next); // optimistic — the sidebar re-gates immediately
    fetch("/api/system/mode", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: next }),
    })
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
      })
      .catch(() => {
        // Server didn't take it — revert so the UI never claims an armed
        // state the scheduler doesn't actually have.
        setModeState(next === "x" ? "base" : "x");
      });
  }, []);

  return (
    <WorkspaceModeContext.Provider value={{ mode, loaded, setMode }}>
      {children}
    </WorkspaceModeContext.Provider>
  );
}

export function useWorkspaceMode(): WorkspaceModeValue {
  return useContext(WorkspaceModeContext);
}
