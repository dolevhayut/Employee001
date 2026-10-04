import { NextResponse } from "next/server";
import { loadDemoRecording } from "@/lib/demo-replay";

// Read at request time: workspace pages are prerendered at build time, when
// EMPLOYEE001_DEMO is never set, so the banner can't take this from the layout.
export const dynamic = "force-dynamic";

export async function GET() {
  if (process.env.EMPLOYEE001_DEMO !== "1") {
    return NextResponse.json({ demo: false }, { headers: { "Cache-Control": "no-store" } });
  }
  let question: string | undefined;
  try {
    question = (await loadDemoRecording()).question;
  } catch {
    // The meeting itself surfaces a recording configuration error.
  }
  return NextResponse.json(
    { demo: true, live: process.env.EMPLOYEE001_DEMO_LIVE === "1", question },
    { headers: { "Cache-Control": "no-store" } },
  );
}
