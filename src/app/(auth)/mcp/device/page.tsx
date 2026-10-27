"use client";

import { Suspense, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { cardStyle, ErrorLine, Field, Heading, postJson } from "@/components/auth/auth-form";

// Where the verification_uri from /api/mcp/device/start lands. The MCP client
// shows a code; the signed-in person types (or arrives with) it here. The proxy
// sends a signed-out visitor to /login first and brings them back.

function DeviceInner() {
  const params = useSearchParams();
  const [code, setCode] = useState(params.get("code") ?? "");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { ok, data } = await postJson<{ message?: string }>("/api/mcp/device/approve", { user_code: code.trim() });
    setBusy(false);
    if (ok) setDone(true);
    else setError(data.message ?? "Could not approve that code. Try again.");
  }

  if (done) {
    return (
      <div style={cardStyle}>
        <Heading title="Device approved" sub="You can close this tab. The app that showed you the code is now signed in as you." />
      </div>
    );
  }

  return (
    <div style={cardStyle}>
      <Heading title="Approve a device" sub="Enter the code shown by the app you are connecting to Employee001. Only approve if the code matches the one on your own screen, and you started this sign-in yourself. Never approve a code someone sent you." />
      <form onSubmit={submit}>
        <Field id="user-code" label="Device code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="ABCD-2345" autoComplete="off" autoFocus />
        <ErrorLine>{error}</ErrorLine>
        <button type="submit" disabled={busy || !code.trim()} className="btn primary lg" style={{ width: "100%", justifyContent: "center", marginTop: "var(--sp-8)" }}>
          {busy ? "Approving…" : "Approve"}
        </button>
      </form>
    </div>
  );
}

export default function McpDevicePage() {
  return (
    <Suspense fallback={null}>
      <DeviceInner />
    </Suspense>
  );
}
