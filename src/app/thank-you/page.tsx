import type { Metadata } from "next";
import Link from "next/link";
import type { ReactElement } from "react";
import { buildMetadata } from "@/lib/seo";
import { siteConfig } from "@/site.config";

export const metadata: Metadata = buildMetadata({
  title: "Thank You",
  description: `Thanks for contacting ${siteConfig.businessName}.`,
  path: "/thank-you",
});

export default function ThankYouPage(): ReactElement {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center gap-4 px-6 py-24 text-center">
      <h1 className="text-3xl font-bold">Thank you!</h1>
      <p className="text-neutral-600 dark:text-neutral-400">
        Your message is on its way to {siteConfig.businessName}. We will get
        back to you shortly.
      </p>
      <Link href="/" className="mt-4 underline">
        Back to home
      </Link>
    </div>
  );
}
