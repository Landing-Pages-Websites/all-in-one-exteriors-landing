"use client";

import { useSyncExternalStore } from "react";
import {
  getConsentStatus,
  isAnalyticsAllowed,
  setConsentStatus,
  subscribeToConsent,
  type ConsentStatus,
} from "@/lib/consent";
import { getPostHogClient } from "@/lib/posthog-client";

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

export interface UseConsentResult {
  /** "unset" until the visitor chooses (and always "unset" during SSR). */
  status: ConsentStatus;
  /**
   * Whether analytics loaders may run, per siteConfig.consentMode.
   * Always false during SSR/hydration so a previously-declined visitor
   * never gets a script tag in server HTML.
   */
  analyticsAllowed: boolean;
  accept: () => void;
  decline: () => void;
}

function getServerSnapshot(): ConsentStatus {
  return "unset";
}

// Hydration detector via useSyncExternalStore: false during SSR/hydration
// render, true immediately after — without an effect-driven setState.
function subscribeNever(): () => void {
  return () => {};
}
function getClientTrue(): boolean {
  return true;
}
function getServerFalse(): boolean {
  return false;
}

/** Best-effort stop for analytics that already loaded (us-default opt-out). */
function optOutLoadedAnalytics(): void {
  window.gtag?.("consent", "update", { analytics_storage: "denied" });
  getPostHogClient()?.opt_out_capturing();
}

/** Reactive consent state — analytics loaders gate on analyticsAllowed. */
export function useConsent(): UseConsentResult {
  const status = useSyncExternalStore(
    subscribeToConsent,
    getConsentStatus,
    getServerSnapshot,
  );

  // Analytics stay off until after hydration: in us-default mode "unset"
  // means allowed, but the server can't know a returning visitor declined.
  const hydrated = useSyncExternalStore(
    subscribeNever,
    getClientTrue,
    getServerFalse,
  );

  return {
    status,
    analyticsAllowed: hydrated && isAnalyticsAllowed(status),
    accept: () => setConsentStatus("accepted"),
    decline: () => {
      setConsentStatus("declined");
      optOutLoadedAnalytics();
    },
  };
}
