"use client";

import Script from "next/script";
import type { ReactElement } from "react";
import { useConsent } from "@/components/consent/useConsent";

const GA4_ID = process.env.NEXT_PUBLIC_GA4_ID;

/**
 * GA4 gtag loader. Renders nothing until NEXT_PUBLIC_GA4_ID is set (by the
 * provisioning bot) AND the visitor has accepted cookies.
 */
export function GoogleAnalytics(): ReactElement | null {
  const { analyticsAllowed } = useConsent();

  if (!GA4_ID || !analyticsAllowed) {
    return null;
  }

  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${GA4_ID}`}
        strategy="afterInteractive"
      />
      <Script id="ga4-init" strategy="afterInteractive">
        {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${GA4_ID}');`}
      </Script>
    </>
  );
}
