export type LandingAnalyticsEvent =
  | "landing_viewed"
  | "hero_cta_clicked"
  | "secondary_cta_clicked"
  | "usp_card_viewed"
  | "usp_card_clicked"
  | "waitlist_form_started"
  | "waitlist_form_submitted"
  | "waitlist_form_error"
  | "integration_section_viewed"
  | "execution_section_viewed"
  | "install_copied";

export function trackLandingEvent(
  event: LandingAnalyticsEvent,
  detail?: Record<string, unknown>,
): void {
  if (typeof window === "undefined") return;
  const payload = { event, ...detail, ts: new Date().toISOString() };
  window.dispatchEvent(
    new CustomEvent("employee001_landing", { detail: payload }),
  );
  const w = window as unknown as { dataLayer?: unknown[] };
  if (Array.isArray(w.dataLayer)) {
    w.dataLayer.push(payload);
  }
}
