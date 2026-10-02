import type { ReactElement } from "react";
import { siteConfig } from "@/site.config";

/**
 * Mega optimizer (lead capture, conversion tracking, form-field capture via
 * input `name` attributes).
 *
 * The MEGA_TAG_CONFIG + API endpoint globals MUST be set before the optimizer
 * script executes, via plain inline <script> tags — the landing-page-tracking
 * skill explicitly forbids next/script here (`beforeInteractive` queues
 * instead of executing immediately). The inline tag executes synchronously at
 * parse time; the async optimizer script always runs after it.
 *
 * INTENTIONALLY NOT CONSENT-GATED: this is the business-critical
 * lead-capture/optimizer script — gating it behind the cookie banner would
 * drop leads. Decision made by Peter's assistant; flagged for review.
 * GA4/PostHog remain consent-gated.
 */
export function MegaSnippet(): ReactElement {
  const bootstrap =
    `window.MEGA_TAG_CONFIG=${JSON.stringify({ siteKey: siteConfig.megaSiteKey })};` +
    `window.API_ENDPOINT="https://optimizer.gomega.ai";` +
    `window.TRACKING_API_ENDPOINT="https://events-api.gomega.ai";`;

  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: bootstrap }} />
      <script src="https://cdn.gomega.ai/scripts/optimizer.min.js" async />
    </>
  );
}
