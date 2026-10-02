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
      className="fixed inset-x-0 bottom-0 z-50 border-t border-black/10 bg-white p-4 shadow-lg dark:border-white/10 dark:bg-neutral-900"
    >
      <div className="mx-auto flex max-w-3xl flex-col items-start gap-3 sm:flex-row sm:items-center">
        <p className="text-sm text-neutral-700 dark:text-neutral-300">
          {siteConfig.businessName} uses cookies for analytics to improve this
          site. See our{" "}
          <Link href="/cookie-policy" className="underline">
            cookie policy
          </Link>
          .
        </p>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={accept}
            aria-label="Accept analytics cookies"
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
          >
            {strict ? "Accept" : "Got it"}
          </button>
          <button
            type="button"
            onClick={decline}
            aria-label="Decline analytics cookies"
            className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            Decline
          </button>
        </div>
      </div>
    </div>
  );
}
