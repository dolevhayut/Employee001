"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { EMPLOYEES, type Employee } from "@/lib/demo";
import { Shell, Topbar } from "@/components/ex/shell";

export default function ClonePage() {
  const [selected, setSelected] = useState<Employee | null>(null);
  const [leaving, setLeaving] = useState(false);
  const router = useRouter();

  function handleBegin() {
    if (!selected) return;
    setLeaving(true);
    setTimeout(() => {
      router.push(`/onboarding?employee=${selected.id}`);
    }, 600);
  }

  return (
    <Shell>
      <Topbar crumbs={["Clone"]} />
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: leaving ? 0 : 1 }}
        transition={{ duration: 0.5 }}
        style={{
          flex: 1,
          overflow: "auto",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "var(--sp-40) var(--sp-24)",
          fontFamily: "var(--font)",
          color: "var(--text)",
          background: "var(--bg)",
        }}
      >
        {/* Headline */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.2 }}
          style={{ textAlign: "center", marginBottom: "var(--sp-64)" }}
        >
          <h1
            style={{
              fontSize: "clamp(28px, 4vw, 44px)",
              fontWeight: 300,
              letterSpacing: "var(--ls-tight)",
              color: "var(--text)",
              marginBottom: "var(--sp-10)",
              lineHeight: "var(--lh-tight)",
            }}
          >
            Who are you cloning?
          </h1>
          <p
            style={{
              fontSize: "var(--fs-body)",
              fontWeight: 400,
              color: "var(--text-subtle)",
              letterSpacing: "0.01em",
            }}
          >
            Select an employee to build their digital twin.
          </p>
        </motion.div>

        {/* Employee Cards */}
        <div
          style={{
            display: "flex",
            gap: "var(--sp-20)",
            flexWrap: "wrap",
            justifyContent: "center",
            marginBottom: "var(--sp-64)",
          }}
        >
          {EMPLOYEES.map((emp, i) => {
            const isSelected = selected?.id === emp.id;
            return (
              <motion.div
                key={emp.id}
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.3 + i * 0.1 }}
                style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--sp-10)" }}
              >
                <motion.button
                  onClick={() => setSelected(isSelected ? null : emp)}
                  style={{
                    width: 220,
                    padding: "var(--sp-32) var(--sp-24)",
                    background: isSelected ? "var(--text)" : "var(--surface)",
                    border: `1.5px solid ${isSelected ? "var(--text)" : "var(--hairline)"}`,
                    borderRadius: "var(--radius-lg)",
                    cursor: "pointer",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: "var(--sp-16)",
                    transition: "all 0.25s ease",
                    boxShadow: isSelected ? "var(--shadow-lg)" : "var(--shadow-sm)",
                    color: isSelected ? "var(--bg)" : "var(--text)",
                  }}
                  whileHover={{ y: -3 }}
                  whileTap={{ scale: 0.98 }}
                >
                  <div
                    style={{
                      width: 64,
                      height: 64,
                      borderRadius: "50%",
                      background: isSelected ? "rgba(255,255,255,0.12)" : emp.avatarColor,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "var(--fs-h4)",
                      fontWeight: 600,
                      color: isSelected ? "var(--bg)" : "var(--text)",
                      letterSpacing: "var(--ls-wide)",
                      border: isSelected ? "1.5px solid rgba(255,255,255,0.15)" : "none",
                    }}
                  >
                    {emp.initials}
                  </div>

                  <div style={{ textAlign: "center" }}>
                    <div
                      style={{
                        fontSize: "var(--fs-body)",
                        fontWeight: 600,
                        color: isSelected ? "var(--bg)" : "var(--text)",
                        marginBottom: "var(--sp-4)",
                        letterSpacing: "var(--ls-snug)",
                      }}
                    >
                      {emp.name}
                    </div>
                    <div
                      style={{
                        fontSize: "var(--fs-sm)",
                        fontWeight: 400,
                        color: isSelected ? "rgba(255,255,255,0.5)" : "var(--text-subtle)",
                        letterSpacing: "0.02em",
                      }}
                    >
                      {emp.role}
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: "var(--sp-5)", marginTop: "var(--sp-4)" }}>
                    {emp.integrations.slice(0, 5).map((intId) => (
                      <div
                        key={intId}
                        style={{
                          width: 5,
                          height: 5,
                          borderRadius: "50%",
                          background: isSelected ? "rgba(255,255,255,0.3)" : "var(--hairline)",
                        }}
                      />
                    ))}
                  </div>
                </motion.button>
              </motion.div>
            );
          })}
        </div>

        {/* Begin CTA */}
        <AnimatePresence>
          {selected && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.3 }}
              style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--sp-14)" }}
            >
              <motion.button
                onClick={handleBegin}
                style={{
                  padding: "var(--sp-16) var(--sp-56)",
                  background: "var(--text)",
                  color: "var(--bg)",
                  border: "none",
                  borderRadius: 100,
                  fontSize: "var(--fs-ui)",
                  fontWeight: 600,
                  letterSpacing: "var(--ls-wider)",
                  textTransform: "uppercase",
                  cursor: "pointer",
                  fontFamily: "var(--font)",
                }}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.97 }}
              >
                Begin
              </motion.button>
              <p style={{ fontSize: "var(--fs-sm)", color: "var(--text-muted)", letterSpacing: "0.01em" }}>
                {selected.firstName} will receive a secure link to connect their accounts.
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </Shell>
  );
}
