"use client";

import { useCallback } from "react";
import { getPostHogClient } from "@/lib/posthog-client";
import type { RoofLeadFields, RoofLeadQualification } from "@/lib/roofLead";
import { siteConfig } from "@/site.config";

type FbqArgs = [command: "track" | "trackCustom", event: string, params?: Record<string, string>];

declare global {
  interface Window {
    fbq?: (...args: FbqArgs) => void;
  }
}

const META_LEAD_CONTENT_NAME = "Roof Estimate";

function pushDataLayer(event: Record<string, unknown>): void {
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push(event);
}

/** MegaTag event values are strings; the booleans keep their form_data keys. */
function qualificationProps(qualification: RoofLeadQualification): Record<string, string> {
  return {
    qualified: String(qualification.qualified),
    isDisqualified: String(qualification.isDisqualified),
    urgency: qualification.urgency,
  };
}

/** A tracker failing must never turn a stored lead into a visible error. */
function safely(send: () => void): void {
  try {
    send();
  } catch {
    // Destinations are best-effort; MEGA already confirmed the lead.
  }
}

/**
 * Call ONLY after the MEGA endpoint returned `{ ok: true }`.
 *
 * Every stored lead, qualified or not, emits the form capture: the manual
 * MegaTag `form_submit` with each field as its own key, plus the distinct
 * dataLayer `form_submission`. `qualified_lead` and the Meta `Lead` fire for
 * qualified leads only, never for a disqualified submission.
 */
export function trackLeadCaptured(
  formKey: string,
  fields: RoofLeadFields,
  qualification: RoofLeadQualification,
): void {
  const formId = `form-${formKey}`;
  safely(() =>
    window.MegaTag?.trackEvent?.("form_submit", {
      element: formId,
      ...fields,
      ...qualificationProps(qualification),
    }),
  );
  safely(() =>
    pushDataLayer({
      event: "form_submission",
      form_id: formId,
      form_provider: siteConfig.sourceProvider,
      ...qualification,
    }),
  );
  if (!qualification.qualified) return;
  safely(() => pushDataLayer({ event: "qualified_lead", form_id: formId, urgency: qualification.urgency }));
  safely(() => window.fbq?.("track", "Lead", { content_name: META_LEAD_CONTENT_NAME }));
  safely(() => getPostHogClient()?.capture("qualified_lead", { form_key: formKey, urgency: qualification.urgency }));
}

export interface UseTrackingReturn {
  /** Click on any tel: link. CTM tracks the call itself; this tags the intent. */
  trackPhoneClick: (location: string) => void;
  /** Click on an on-page "request estimate" CTA that scrolls to a form. */
  trackCtaClick: (label: string, location: string) => void;
}

/** On-page CTA and phone-click tracking. The optimizer itself loads in layout.tsx. */
export function useTracking(): UseTrackingReturn {
  const trackPhoneClick = useCallback((location: string): void => {
    safely(() => pushDataLayer({ event: "phone_click", cta_location: location }));
    safely(() => window.fbq?.("track", "Contact", { content_name: location }));
    safely(() => getPostHogClient()?.capture("phone_click", { cta_location: location }));
  }, []);

  const trackCtaClick = useCallback((label: string, location: string): void => {
    safely(() => pushDataLayer({ event: "cta_click", cta_label: label, cta_location: location }));
    safely(() => getPostHogClient()?.capture("cta_click", { cta_label: label, cta_location: location }));
  }, []);

  return { trackPhoneClick, trackCtaClick };
}
