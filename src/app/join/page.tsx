"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

// The employee lands here from a /join?invite=inv_... URL the CEO shared.
// We validate the invite once, surface a short welcome, and route forward
// to /onboarding?invite=... where the actual profile gets filled in.

type InviteShape = {
  token: string;
  name?: string;
  role?: string;
  expiresAt: string;
};

type ValidateResponse =
  | { status: "redeemable"; invite: InviteShape }
  | { status: "used"; invite: InviteShape }
  | { status: "expired"; invite: InviteShape }
  | { status: "not_found" };

const SANS_FONT =
  'ui-sans-serif, -apple-system, "Manrope", system-ui, sans-serif';
const SERIF_FONT =
  '"Instrument Serif", ui-serif, Georgia, Cambria, "Times New Roman", serif';

function Page() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("invite") ?? "";
  const justFinished = params.get("done") === "1";

  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "no_token" }
    | { kind: "error"; status: ValidateResponse["status"] }
    | { kind: "ready"; invite: InviteShape }
    | { kind: "done"; invite?: InviteShape }
  >(justFinished ? { kind: "done" } : { kind: "loading" });

  useEffect(() => {
    if (justFinished) return; // success view is its own thing
    if (!token) {
      setState({ kind: "no_token" });
      return;
    }
    fetch(`/api/invites/${encodeURIComponent(token)}`)
      .then(async (r) => {
        const data: ValidateResponse = await r.json();
        if (data.status === "redeemable") {
          setState({ kind: "ready", invite: data.invite });
        } else {
          setState({ kind: "error", status: data.status });
        }
      })
      .catch(() => setState({ kind: "error", status: "not_found" }));
  }, [token, justFinished]);

  function go() {
    router.push(`/onboarding?invite=${encodeURIComponent(token)}`);
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#F5F1EA",
        color: "#1A1816",
        display: "grid",
        placeItems: "center",
        padding: "48px 24px",
        fontFamily: SANS_FONT,
      }}
    >
      <div style={{ maxWidth: 520, width: "100%" }}>
        <div
          className="card"
          style={{
            background: "#FFFFFF",
            border: "1px solid #E5DDD0",
            borderRadius: 14,
            padding: "44px 36px",
            boxShadow: "0 8px 24px -16px rgba(0,0,0,0.08)",
          }}
        >
          <div
            style={{
              fontSize: 12,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "#8F8678",
              marginBottom: 14,
            }}
          >
            Employee001
          </div>

          {state.kind === "loading" && (
            <div style={{ color: "#6B6359", fontSize: 14 }}>
              Checking your invite…
            </div>
          )}

          {state.kind === "no_token" && (
            <>
              <h1 style={{ fontFamily: SERIF_FONT, fontSize: 32, margin: "0 0 12px" }}>
                Invite link required.
              </h1>
              <p style={{ color: "#6B6359", fontSize: 15, lineHeight: 1.55 }}>
                This page expects an invitation token. Ask your CEO for the
                /join link they generated.
              </p>
            </>
          )}

          {state.kind === "error" && (
            <>
              <h1 style={{ fontFamily: SERIF_FONT, fontSize: 32, margin: "0 0 12px" }}>
                {state.status === "used"
                  ? "This invite was already used."
                  : state.status === "expired"
                    ? "This invite expired."
                    : "Invite not found."}
              </h1>
              <p style={{ color: "#6B6359", fontSize: 15, lineHeight: 1.55 }}>
                Ask your CEO to send a fresh link.
              </p>
            </>
          )}

          {state.kind === "done" && (
            <>
              <div
                style={{
                  fontSize: 36,
                  lineHeight: 1,
                  marginBottom: 18,
                }}
              >
                ✓
              </div>
              <h1
                style={{
                  fontFamily: SERIF_FONT,
                  fontSize: 32,
                  margin: "0 0 12px",
                  lineHeight: 1.1,
                }}
              >
                You&apos;re all set.
              </h1>
              <p
                style={{
                  color: "#6B6359",
                  fontSize: 15,
                  lineHeight: 1.55,
                  marginBottom: 8,
                }}
              >
                Your twin profile has been saved on the team&apos;s machine. You
                can close this tab.
              </p>
              <p
                style={{
                  color: "#8F8678",
                  fontSize: 13,
                  lineHeight: 1.55,
                }}
              >
                Your CEO can connect tools and bring the twin online from
                their side.
              </p>
            </>
          )}

          {state.kind === "ready" && (
            <>
              <h1 style={{ fontFamily: SERIF_FONT, fontSize: 36, margin: "0 0 12px", lineHeight: 1.1 }}>
                Welcome{state.invite.name ? `, ${state.invite.name}` : ""}.
              </h1>
              <p
                style={{
                  color: "#6B6359",
                  fontSize: 15,
                  lineHeight: 1.55,
                  marginBottom: 28,
                }}
              >
                You&apos;ve been invited to set up your AI twin
                {state.invite.role ? ` as ${state.invite.role}` : ""}.
                It&apos;ll run on your team&apos;s machine and answer questions
                in your voice, drawing only from what you tell it.
              </p>
              <button
                type="button"
                onClick={go}
                style={{
                  background: "#1A1816",
                  color: "#F5F1EA",
                  border: "none",
                  padding: "12px 22px",
                  borderRadius: 999,
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  letterSpacing: "-0.01em",
                }}
              >
                Set up my twin →
              </button>
            </>
          )}
        </div>
      </div>
    </main>
  );
}

export default function JoinPage() {
  return (
    <Suspense fallback={null}>
      <Page />
    </Suspense>
  );
}
