export async function register(): Promise<void> {
  if (
    process.env.NEXT_RUNTIME !== "nodejs" ||
    process.env.NEXT_PHASE === "phase-production-build"
  ) {
    return;
  }

  const { removeLegacyDebugLog } = await import("@/lib/legacy-cleanup");
  removeLegacyDebugLog();
  const { markTwinsConsentRequired } = await import("@/lib/consent-migration");
  markTwinsConsentRequired();

  const { residencyWarnings } = await import("@/lib/data-residency");
  for (const warning of residencyWarnings()) console.warn(`[employee001] ${warning}`);

  const { ensureSchedulerStarted } = await import("@/lib/routine-scheduler");
  ensureSchedulerStarted();
}
