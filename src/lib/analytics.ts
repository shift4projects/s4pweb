// Thin wrappers around the Google tag and Meta Pixel the server injects (server/tracking.ts).
// Every call is a no-op when the tags aren't configured.

type Fn = (...args: unknown[]) => void;
declare global {
  interface Window {
    gtag?: Fn;
    fbq?: Fn;
    __TRACK__?: { google: string[]; ads?: string; meta: boolean };
  }
}

/** SPA route change. GA4 counts these itself (enhanced measurement: browser history), so only Meta needs a nudge. */
export function trackPageView() {
  window.fbq?.("track", "PageView");
}

/** The conversion: a contact form inquiry was saved. */
export function trackLead(services: string[]) {
  const t = window.__TRACK__;
  if (!t) return;
  const label = services.join(", ") || "none";
  window.gtag?.("event", "generate_lead", { form_name: "contact", services: label });
  if (t.ads) window.gtag?.("event", "conversion", { send_to: t.ads });
  window.fbq?.("track", "Lead", { content_name: "Contact form", content_category: label });
}
