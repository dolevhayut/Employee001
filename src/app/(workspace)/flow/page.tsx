"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Topbar } from "@/components/ex/shell";
import {
  ObsidianGraph,
  type GraphHighlightState,
} from "@/components/ex/obsidian-graph";
import { RealFileDrawer } from "@/components/ex/real-file-drawer";
import { TwinChatPane } from "@/components/ex/twin-chat-pane";
import { type EmployeeWithTwin } from "@/lib/employees";
import { useRoster } from "@/components/ex/roster-context";
import type { TwinTraceEvent } from "@/lib/ex-graph-types";
import type { EmployeeGraph } from "@/lib/profile-graph-real";

const TOUCHED_LINGER_MS = 3000;

// The graph/chat split ratio is persisted in localStorage and shared as an
// external store, so the client hydrates from it without a mount-time setState
// (and without a hydration mismatch — the server snapshot is the default).
const CHAT_WIDTH_KEY = "flow.chatWidthPct";
const CHAT_WIDTH_DEFAULT = 34;
const chatWidthListeners = new Set<() => void>();

function chatWidthSubscribe(cb: () => void): () => void {
  chatWidthListeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    chatWidthListeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

function chatWidthSnapshot(): number {
  try {
    const saved = localStorage.getItem(CHAT_WIDTH_KEY);
    if (saved !== null) {
      const n = parseFloat(saved);
      if (!Number.isNaN(n) && n >= 22 && n <= 70) return n;
    }
  } catch {
    // ignore
  }
  return CHAT_WIDTH_DEFAULT;
}

function chatWidthServerSnapshot(): number {
  return CHAT_WIDTH_DEFAULT;
}

function writeChatWidth(pct: number): void {
  try {
    localStorage.setItem(CHAT_WIDTH_KEY, String(pct));
  } catch {
    // ignore
  }
  chatWidthListeners.forEach((cb) => cb());
}

export default function FlowPage() {
  const roster = useRoster();
  const readyEmployees = useMemo(
    () => roster.filter((e) => e.twinStatus === "ready"),
    [roster],
  );
  const [selectedId, setSelectedId] = useState<string>("");
  // Honor an explicit user selection, otherwise default to the first ready
  // twin once the roster hydrates. Deriving during render (instead of syncing
  // via an effect) avoids a mount-time setState.
  const activeId = selectedId || readyEmployees[0]?.id || "";
  const [graph, setGraph] = useState<EmployeeGraph | null>(null);
  // Only "loading" if there's actually a twin to fetch at mount.
  const [graphLoading, setGraphLoading] = useState<boolean>(() =>
    Boolean(activeId),
  );
  const [openFile, setOpenFile] = useState<string | null>(null);
  const [highlightState, setHighlightState] = useState<GraphHighlightState>({
    reading: new Set<string>(),
    recentlyTouched: new Set<string>(),
    cited: new Set<string>(),
  });

  // Reset the graph view when the active twin changes. Adjusting state during
  // render (the React "reset state when a prop changes" pattern) instead of in
  // an effect avoids a synchronous setState-in-effect cascade; the async fetch
  // itself stays in the effect below.
  const [prevActiveId, setPrevActiveId] = useState(activeId);
  if (activeId !== prevActiveId) {
    setPrevActiveId(activeId);
    setGraph(null);
    setGraphLoading(Boolean(activeId));
    setHighlightState({
      reading: new Set<string>(),
      recentlyTouched: new Set<string>(),
      cited: new Set<string>(),
    });
    setOpenFile(null);
  }

  const touchedTimeouts = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map()
  );

  // ── Resizable split between graph and chat ─────────────────────────────────
  const splitContainerRef = useRef<HTMLDivElement>(null);
  const chatWidthPct = useSyncExternalStore(
    chatWidthSubscribe,
    chatWidthSnapshot,
    chatWidthServerSnapshot,
  );
  const [isResizing, setIsResizing] = useState(false);

  useEffect(() => {
    if (!isResizing) return;

    function onMove(e: MouseEvent) {
      const el = splitContainerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const fromRight = rect.right - e.clientX;
      const pct = (fromRight / rect.width) * 100;
      // Clamp 22% – 70%
      writeChatWidth(Math.max(22, Math.min(70, pct)));
    }
    function onUp() {
      setIsResizing(false);
    }

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizing]);

  const activeEmployee: EmployeeWithTwin | undefined = useMemo(
    () => readyEmployees.find((e) => e.id === activeId),
    [activeId]
  );

  // Fetch graph when active employee changes. The view reset happens during
  // render (above); this effect only performs the async fetch, whose setStates
  // land in promise callbacks rather than synchronously in the effect body.
  useEffect(() => {
    if (!activeId) return;
    let cancelled = false;

    fetch(`/api/employees/${encodeURIComponent(activeId)}/graph`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((g: EmployeeGraph) => {
        if (!cancelled) setGraph(g);
      })
      .catch(() => {
        if (!cancelled) setGraph(null);
      })
      .finally(() => {
        if (!cancelled) setGraphLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeId]);

  useEffect(() => {
    const timeouts = touchedTimeouts.current;
    return () => {
      timeouts.forEach((t) => clearTimeout(t));
      timeouts.clear();
    };
  }, []);

  const scheduleTouchedClear = useCallback((file: string) => {
    const existing = touchedTimeouts.current.get(file);
    if (existing) clearTimeout(existing);
    const t = setTimeout(() => {
      setHighlightState((s) => {
        if (!s.recentlyTouched.has(file)) return s;
        const next = new Set(s.recentlyTouched);
        next.delete(file);
        return { ...s, recentlyTouched: next };
      });
      touchedTimeouts.current.delete(file);
    }, TOUCHED_LINGER_MS);
    touchedTimeouts.current.set(file, t);
  }, []);

  /**
   * Map Agent SDK tool events → graph highlights.
   * The new /api/twin/chat emits TwinTraceEvent with names "Read", "Glob", "Grep".
   */
  const handleTrace = useCallback(
    (evt: TwinTraceEvent) => {
      setHighlightState((s) => {
        switch (evt.type) {
          case "tool_call": {
            // Agent SDK: { name: "Read", args: { file_path: "/abs/path/EXPERTISE.md" } }
            if (evt.name === "Read") {
              const filePath = evt.args.file_path as string | undefined;
              if (!filePath) return s;
              const fileName = filePath.split("/").pop() ?? filePath;
              const reading = new Set(s.reading);
              reading.add(fileName);
              // Clear "reading" after a short delay (Agent SDK tool_results don't always
              // include file names cleanly — we time it out instead)
              setTimeout(() => {
                setHighlightState((s2) => {
                  if (!s2.reading.has(fileName)) return s2;
                  const r2 = new Set(s2.reading);
                  r2.delete(fileName);
                  const t2 = new Set(s2.recentlyTouched);
                  t2.add(fileName);
                  scheduleTouchedClear(fileName);
                  return { ...s2, reading: r2, recentlyTouched: t2 };
                });
              }, 1200);
              return { ...s, reading };
            }
            return s;
          }
          case "cite": {
            const cited = new Set(s.cited);
            cited.add(evt.file);
            return { ...s, cited };
          }
          case "done": {
            touchedTimeouts.current.forEach((t) => clearTimeout(t));
            touchedTimeouts.current.clear();
            return {
              reading: new Set<string>(),
              recentlyTouched: new Set<string>(),
              cited: new Set(evt.cited_files),
            };
          }
          default:
            return s;
        }
      });
    },
    [scheduleTouchedClear]
  );

  const handleOpenFile = useCallback((name: string) => {
    setOpenFile(name);
  }, []);

  const handleCloseDrawer = useCallback(() => {
    setOpenFile(null);
  }, []);

  return (
    <>
      <Topbar crumbs={["Workspace", "Memory graph"]} />

      {/* Employee picker bar */}
      <EmployeePickerBar activeId={activeId} onSelect={setSelectedId} />

      <div
        ref={splitContainerRef}
        style={{
          flex: 1,
          display: "flex",
          minHeight: 0,
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Graph (resizable) — id is the portal target for the file/note popup */}
        <div
          id="brain-area"
          style={{
            flex: `1 1 ${100 - chatWidthPct}%`,
            background: "var(--bg)",
            position: "relative",
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <AnimatePresence mode="wait">
            <motion.div
              key={activeId}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
              style={{ flex: 1, display: "flex", flexDirection: "column" }}
            >
              <ObsidianGraph
                graph={graph}
                state={highlightState}
                onOpenFile={handleOpenFile}
                loading={graphLoading}
              />
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Drag handle */}
        <div
          onMouseDown={() => setIsResizing(true)}
          onDoubleClick={() => writeChatWidth(CHAT_WIDTH_DEFAULT)}
          title="Drag to resize · double-click to reset"
          style={{
            flex: "0 0 5px",
            cursor: "col-resize",
            position: "relative",
            background: "var(--hairline)",
            transition: isResizing ? "none" : "background .15s",
            zIndex: 10,
          }}
          onMouseEnter={(e) => {
            if (!isResizing) e.currentTarget.style.background = "var(--accent-soft)";
          }}
          onMouseLeave={(e) => {
            if (!isResizing) e.currentTarget.style.background = "var(--hairline)";
          }}
        >
          {/* Visual grip */}
          <div
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              width: 2,
              height: 28,
              borderRadius: 1,
              background: isResizing ? "var(--accent-deep)" : "var(--text-subtle)",
              opacity: 0.5,
              pointerEvents: "none",
            }}
          />
        </div>

        {/* Chat (resizable) */}
        <div
          style={{
            flex: `1 1 ${chatWidthPct}%`,
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            position: "relative",
          }}
        >
          {activeEmployee && (
            <ChatHeader employee={activeEmployee} />
          )}
          <TwinChatPane
            employeeId={activeId}
            onTrace={handleTrace}
            onOpenFile={handleOpenFile}
          />
        </div>
      </div>
      {/* The file/note popup lives OUTSIDE the chat column so it portals
          into #brain-area instead of sliding in over the chat. */}
      <RealFileDrawer
        employeeId={activeId}
        fileName={openFile}
        onClose={handleCloseDrawer}
        onOpenFile={handleOpenFile}
      />
    </>
  );
}

// ─── Employee picker ──────────────────────────────────────────────────────────

function EmployeePickerBar({
  activeId,
  onSelect,
}: {
  activeId: string;
  onSelect: (id: string) => void;
}) {
  const readyEmployees = useRoster().filter((e) => e.twinStatus === "ready");
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--sp-8)",
        padding: "10px 24px",
        borderBottom: "1px solid var(--hairline)",
        background: "var(--bg-elevated)",
        flexShrink: 0,
        flexWrap: "wrap",
      }}
    >
      <span
        style={{
          fontSize: "var(--fs-meta)",
          fontWeight: 600,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "var(--text-subtle)",
          marginRight: "var(--sp-4)",
        }}
      >
        Twin brain
      </span>
      {readyEmployees.map((emp) => {
        const isActive = emp.id === activeId;
        return (
          <motion.button
            key={emp.id}
            onClick={() => onSelect(emp.id)}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--sp-8)",
              padding: "5px 12px 5px 5px",
              background: isActive ? "var(--surface)" : "transparent",
              border: `1px solid ${isActive ? "var(--accent-soft)" : "transparent"}`,
              borderRadius: 22,
              cursor: "pointer",
              opacity: isActive ? 1 : 0.55,
              transition: "opacity .15s",
              fontFamily: "inherit",
            }}
          >
            <div
              style={{
                width: 26,
                height: 26,
                borderRadius: "50%",
                background: emp.avatarColor,
                display: "grid",
                placeItems: "center",
                fontSize: "var(--fs-xs)",
                fontWeight: 700,
                color: "var(--text)",
              }}
            >
              {emp.initials}
            </div>
            <div
              style={{ display: "flex", flexDirection: "column", textAlign: "left" }}
            >
              <span
                style={{
                  fontSize: "var(--fs-sm)",
                  fontWeight: 600,
                  color: isActive ? "var(--text)" : "var(--text-muted)",
                  lineHeight: 1.2,
                }}
              >
                {emp.firstName}
              </span>
              <span style={{ fontSize: "var(--fs-xs)", color: "var(--text-subtle)", lineHeight: 1.2 }}>
                {emp.role}
              </span>
            </div>
          </motion.button>
        );
      })}
    </div>
  );
}

// ─── Chat header (active employee context) ───────────────────────────────────

function ChatHeader({ employee }: { employee: EmployeeWithTwin }) {
  return (
    <motion.div
      key={employee.id}
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      style={{
        flexShrink: 0,
        padding: "10px 18px",
        borderBottom: "1px solid var(--hairline)",
        background: "var(--bg-elevated)",
        display: "flex",
        alignItems: "center",
        gap: "var(--sp-10)",
      }}
    >
      <div
        style={{
          width: 28,
          height: 28,
          borderRadius: "50%",
          background: employee.avatarColor,
          display: "grid",
          placeItems: "center",
          fontSize: "var(--fs-xs)",
          fontWeight: 700,
          color: "var(--text)",
        }}
      >
        {employee.initials}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: "var(--fs-ui)", fontWeight: 600, color: "var(--text)" }}>
          Chat with {employee.firstName}&apos;s twin
        </div>
        <div style={{ fontSize: "var(--fs-meta)", color: "var(--text-subtle)" }}>
          Watch the graph as the agent reads files in real time
        </div>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--sp-5)",
          padding: "3px 8px",
          background: "var(--surface)",
          border: "1px solid var(--hairline)",
          borderRadius: 12,
          fontSize: "var(--fs-xs)",
          fontWeight: 600,
          color: "var(--success)",
        }}
      >
        <motion.div
          animate={{ opacity: [1, 0.4, 1] }}
          transition={{ duration: 1.5, repeat: Infinity }}
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: "var(--success)",
          }}
        />
        Live
      </div>
    </motion.div>
  );
}
