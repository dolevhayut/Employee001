"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { Icons } from "@/components/ex/icons";

type ActiveBuild = {
  employeeId: string;
  buildId: string;
  startedAt: string;
  lastEventTs: number;
  eventCount: number;
  filesWritten: number;
  filesTotal: number;
  costUsd: number;
};

type EmployeeRow = { id: string; name: string; firstName: string; initials: string; avatarColor: string };

/**
 * Floating chips at the bottom-right showing every Twin Builder run that's
 * currently in flight, across the workspace. Each chip links to
 * `/twin-build?employee=<id>` which auto-reattaches on mount.
 *
 * Polls `/api/twin-builder/active` every 4 s. Cheap — that endpoint just
 * reads `data/active-builds.json` and serializes it.
 */
export function ActiveBuildsBanner() {
  const [builds, setBuilds] = useState<ActiveBuild[]>([]);
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const r = await fetch("/api/twin-builder/active", {
          cache: "no-store",
        });
        const data = (await r.json()) as { builds: ActiveBuild[] };
        if (!cancelled) setBuilds(data.builds ?? []);
      } catch {
        /* ignore — banner just stays as-is */
      }
    };
    tick();
    const id = setInterval(tick, 4000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // Resolve employee names lazily — only when at least one build is active.
  useEffect(() => {
    if (builds.length === 0 || employees.length > 0) return;
    fetch("/api/employees", { cache: "no-store" })
      .then((r) => r.json())
      .then((all: EmployeeRow[]) => setEmployees(all))
      .catch(() => {});
  }, [builds.length, employees.length]);

  const empById = (id: string) => employees.find((e) => e.id === id);

  if (builds.length === 0) return null;

  return (
    <div
      style={{
        position: "fixed",
        right: 18,
        bottom: 18,
        display: "flex",
        flexDirection: "column",
        gap: "var(--sp-8)",
        zIndex: 40,
        pointerEvents: "none",
      }}
    >
      <AnimatePresence initial={false}>
        {builds.map((b) => {
          const emp = empById(b.employeeId);
          const elapsed = Date.now() - new Date(b.startedAt).getTime();
          const mins = Math.floor(elapsed / 60_000);
          const secs = Math.floor((elapsed % 60_000) / 1000);
          return (
            <motion.div
              key={b.buildId}
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 16 }}
              transition={{ duration: 0.18 }}
              style={{ pointerEvents: "auto" }}
            >
              <Link
                href={`/twin-build?employee=${b.employeeId}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--sp-10)",
                  padding: "10px 14px 10px 10px",
                  background: "var(--surface)",
                  border: "1px solid var(--hairline-strong)",
                  borderRadius: 999,
                  fontSize: "var(--fs-sm)",
                  textDecoration: "none",
                  color: "var(--text)",
                  boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
                  minWidth: 240,
                }}
              >
                {emp ? (
                  <span
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: "50%",
                      background: emp.avatarColor,
                      color: "var(--text)",
                      display: "grid",
                      placeItems: "center",
                      fontWeight: 700,
                      fontSize: "var(--fs-xs)",
                      flexShrink: 0,
                    }}
                  >
                    {emp.initials}
                  </span>
                ) : (
                  <span
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: "50%",
                      background: "var(--bg-sunken)",
                      flexShrink: 0,
                    }}
                  />
                )}
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: "var(--success, #2c8b54)",
                    boxShadow: "0 0 0 0 var(--success, #2c8b54)",
                    animation: "abp-pulse 1.4s infinite",
                    flexShrink: 0,
                  }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: "var(--fs-sm)",
                      fontWeight: 600,
                      letterSpacing: "-0.01em",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {emp ? `${emp.firstName}'s twin is rebuilding` : "Twin rebuilding"}
                  </div>
                  <div
                    className="subtle"
                    style={{ fontSize: "var(--fs-xs)", marginTop: "var(--sp-1)" }}
                  >
                    {b.filesWritten}/{b.filesTotal} files · {mins}m {secs}s ·
                    ${b.costUsd.toFixed(2)}
                  </div>
                </div>
                <Icons.Arrow size={12} />
              </Link>
            </motion.div>
          );
        })}
      </AnimatePresence>
      <style jsx>{`
        @keyframes abp-pulse {
          0% {
            box-shadow: 0 0 0 0 rgba(44, 139, 84, 0.5);
          }
          70% {
            box-shadow: 0 0 0 7px rgba(44, 139, 84, 0);
          }
          100% {
            box-shadow: 0 0 0 0 rgba(44, 139, 84, 0);
          }
        }
      `}</style>
    </div>
  );
}
