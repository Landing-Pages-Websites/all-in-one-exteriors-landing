"use client";

import Link from "next/link";
import type { ReactElement } from "react";
import { siteConfig } from "@/site.config";
import { useConsent } from "@/components/consent/useConsent";

/**
 * Lightweight self-built cookie banner (no vendor script). Renders nothing
 * once the visitor has chosen; analytics loaders react via useConsent().
 * In "us-default" mode the banner is informational (analytics already
 * loading) and the primary button reads "Got it"; in "strict" mode it's a
 * true opt-in gate and reads "Accept".
 */
export function ConsentBanner(): ReactElement | null {
  const { status, accept, decline } = useConsent();
  const strict = siteConfig.consentMode === "strict";

  if (status !== "unset") {
    return null;
  }

  return (
    <div
      role="region"
      aria-label="Cookie consent"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-line bg-surface px-4 py-3 text-white shadow-[0_-12px_32px_-16px_rgba(0,0,0,0.8)]"
    >
      <div className="mx-auto flex max-w-3xl flex-col items-start gap-3 sm:flex-row sm:items-center">
        <p className="text-small leading-relaxed text-muted">
          {siteConfig.businessName} uses cookies for analytics to improve this
          site. See our{" "}
          <Link href="/cookie-policy" className="text-white underline underline-offset-2 hover:text-gold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold">
            cookie policy
          </Link>
          .
        </p>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={accept}
            aria-label="Accept analytics cookies"
            className="min-h-11 rounded-[2px] border-2 border-white/80 px-4 py-2 text-small font-bold text-white transition duration-150 ease-brand hover:border-gold hover:text-gold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
          >
            {strict ? "Accept" : "Got it"}
          </button>
          <button
            type="button"
            onClick={decline}
            aria-label="Decline analytics cookies"
            className="min-h-11 rounded-[2px] border-2 border-line px-4 py-2 text-small font-bold text-muted transition duration-150 ease-brand hover:border-gold hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
          >
            Decline
          </button>
        </div>
      </div>
    </div>
  );
}
