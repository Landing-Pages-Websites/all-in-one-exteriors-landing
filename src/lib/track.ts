import { getPostHogClient } from "@/lib/posthog-client";

declare global {
  interface Window {
    dataLayer?: Record<string, unknown>[];
  }
}

/**
 * Fires a conversion/interaction event to every destination that happens to
 * be loaded: GA4 via dataLayer, PostHog via the lazy client. Safe to call
 * unconditionally — it no-ops for destinations that are not initialized
 * (no consent, no env var, or SSR).
 */
export function trackEvent(
  event: string,
  properties: Record<string, unknown> = {},
): void {
  if (typeof window === "undefined") {
    return;
  }
  window.dataLayer?.push({ event, ...properties });
  getPostHogClient()?.capture(event, properties);
}
