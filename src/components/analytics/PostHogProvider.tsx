"use client";

import { useEffect } from "react";
import { setPostHogClient } from "@/lib/posthog-client";
import { useConsent } from "@/components/consent/useConsent";

const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const POSTHOG_HOST =
  process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com";

const IDLE_INIT_DELAY_MS = 3000;
const INTERACTION_EVENTS = ["pointerdown", "keydown", "scroll"] as const;

// Module-level guard: init must run at most once per page load, even if the
// provider remounts.
let initStarted = false;

async function initPostHog(): Promise<void> {
  if (initStarted || !POSTHOG_KEY) {
    return;
  }
  initStarted = true;
  // Dynamic import keeps posthog-js out of the initial JS payload.
  const { default: posthog } = await import("posthog-js");
  posthog.init(POSTHOG_KEY, {
    // Same-origin reverse proxy (see rewrites in next.config.ts) so requests
    // are not blocked by ad blockers.
    api_host: "/ingest",
    ui_host: POSTHOG_HOST.replace(".i.posthog.com", ".posthog.com"),
    defaults: "2025-05-24",
    // Recording is enabled later per-site once explicitly requested.
    disable_session_recording: true,
  });
  setPostHogClient(posthog);
}

/**
 * Lazy PostHog loader. Requires NEXT_PUBLIC_POSTHOG_KEY AND allowed
 * consent (per siteConfig.consentMode); then initializes on first interaction or after 3s idle,
 * whichever comes first.
 */
export function PostHogProvider(): null {
  const { analyticsAllowed } = useConsent();

  useEffect(() => {
    if (!analyticsAllowed || !POSTHOG_KEY || initStarted) {
      return;
    }

    const timeoutId = window.setTimeout(trigger, IDLE_INIT_DELAY_MS);

    function cleanup(): void {
      window.clearTimeout(timeoutId);
      for (const eventName of INTERACTION_EVENTS) {
        window.removeEventListener(eventName, trigger);
      }
    }

    function trigger(): void {
      cleanup();
      void initPostHog();
    }

    for (const eventName of INTERACTION_EVENTS) {
      window.addEventListener(eventName, trigger, { passive: true });
    }

    return cleanup;
  }, [analyticsAllowed]);

  return null;
}
