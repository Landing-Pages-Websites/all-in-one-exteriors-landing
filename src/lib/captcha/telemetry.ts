import { getPostHogClient } from "@/lib/posthog-client";

/**
 * Why the captcha could not produce a token.
 *
 * Kept as distinct values rather than one boolean because the causes have
 * different owners and wildly different frequencies. `script_blocked` is a
 * visitor-side network condition and is expected to dominate; `unconfigured`
 * is a provisioning defect and should be zero. Collapsing them would make the
 * common case hide the one that means a site shipped wrong — the same shape as
 * the go-live check that reported "wrong target" for a site that simply had no
 * captcha.
 */
export type CaptchaUnavailableReason =
  /** No site key in the bundle. A provisioning failure, never a visitor one. */
  | "unconfigured"
  /** The provider's script did not load: ad blocker, DNS sinkhole, firewall. */
  | "script_blocked"
  /** Script loaded, widget would not render. */
  | "render_failed"
  /** The provider's own error callback fired after a successful render. */
  | "runtime_error"
  /** The challenge expired before submit. */
  | "expired"
  /** execute() exceeded its timeout. */
  | "execute_timeout"
  /** execute() threw or the widget was gone by then. */
  | "execute_failed";

/**
 * Record that a visitor could not obtain a captcha token.
 *
 * **This is the silent-loss counter.** `/api/lead` fails closed, so when the
 * captcha cannot produce a token the submission never leaves the browser and
 * nothing server-side observes it: the lead is gone and no row, log or metric
 * anywhere records that a person tried. Every other failure in the lead path
 * leaves a trace; this one did not.
 *
 * Best-effort by construction. It is called from a form the visitor is trying
 * to submit, so it must never throw, never block and never be the reason a
 * retry fails. No PII: the reason and the provider are the whole payload.
 */
export function reportCaptchaUnavailable(
  reason: CaptchaUnavailableReason,
  provider: "recaptcha" | "turnstile",
): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({ event: "captcha_unavailable", reason, provider });
    window.MegaTag?.trackEvent?.("captcha_unavailable", { reason, provider });
    getPostHogClient()?.capture("captcha_unavailable", { reason, provider });
  } catch {
    // An analytics failure must never cost the visitor their retry.
  }
}
