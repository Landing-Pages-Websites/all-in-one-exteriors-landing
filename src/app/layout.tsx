import type { Metadata } from "next";
import type { ReactElement, ReactNode } from "react";
import Script from "next/script";
import { Montserrat } from "next/font/google";
import { GoogleAnalytics } from "@/components/analytics/GoogleAnalytics";
import { LeadAttribution } from "@/components/analytics/LeadAttribution";
import { GomegaReviewBridge } from "@/components/analytics/GomegaReviewBridge";
import { PostHogProvider } from "@/components/analytics/PostHogProvider";
import { ConsentBanner } from "@/components/consent/ConsentBanner";
import { buildMetadata } from "@/lib/seo";
import { siteConfig } from "@/site.config";
import "./globals.css";

// The client's brand face (their site's Elementor global typography).
const montserrat = Montserrat({
  variable: "--font-montserrat",
  subsets: ["latin"],
  display: "swap",
});

/**
 * The one MegaTag config. The optimizer injects GTM and the Meta Pixel from
 * gtmId/pixelId, so neither is installed by hand. siteId/siteKey come from
 * site.config.ts (Flow B placeholders until `mega site-tracking enable`).
 * Plain inline <script>, never next/script: it must run before the optimizer.
 */
const MEGA_TAG_BOOTSTRAP =
  `window.MEGA_TAG_CONFIG={siteId:"${siteConfig.megaSiteId}",siteKey:"${siteConfig.megaSiteKey}",gtmId:"GTM-PCXQBG7X",pixelId:"1620710171744846"};` +
  `window.API_ENDPOINT="https://optimizer.gomega.ai";` +
  `window.TRACKING_API_ENDPOINT="https://events-api.gomega.ai";`;

/** CallTrackingMetrics universal script; swaps the routing number for attribution. */
const CTM_SCRIPT_SRC = "https://572388.tctm.co/t.js";

export const metadata: Metadata = buildMetadata();

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>): ReactElement {
  return (
    <html
      lang={siteConfig.locale}
      className={`${montserrat.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: MEGA_TAG_BOOTSTRAP }} />
        <script id="optimizer-script" src="https://cdn.gomega.ai/scripts/optimizer.min.js" async />
        <GomegaReviewBridge />
      </head>
      <body className="min-h-full flex flex-col bg-ink font-sans text-white">
        <a href="#main-content" className="skip-link">
          Skip to main content
        </a>
        <main id="main-content" className="flex flex-1 flex-col">
          {children}
        </main>
        <ConsentBanner />
        <GoogleAnalytics />
        <LeadAttribution />
        <PostHogProvider />
        <Script id="ctm-universal" src={CTM_SCRIPT_SRC} strategy="afterInteractive" />
      </body>
    </html>
  );
}
