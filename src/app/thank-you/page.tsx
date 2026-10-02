import type { Metadata } from "next";
import Image from "next/image";
import type { ReactElement } from "react";
import { PhoneLink } from "@/components/lp/Cta";
import { Icon } from "@/components/lp/Icon";
import { buildMetadata } from "@/lib/seo";
import { siteConfig } from "@/site.config";

export const metadata: Metadata = buildMetadata({
  title: "Thank You",
  description: `Thanks for requesting a roof estimate from ${siteConfig.businessName}.`,
  path: "/thank-you",
  robots: { index: false, follow: false },
});

/** Post-submit confirmation. The ad click's query string arrives intact for attribution. */
export default function ThankYouPage(): ReactElement {
  return (
    <div className="flex flex-1 flex-col bg-ink">
      <header className="border-b border-line">
        <div className="mx-auto flex h-[4.5rem] max-w-[1240px] items-center px-4 sm:px-6">
          <Image
            src="/logo.png"
            alt={siteConfig.businessName}
            width={160}
            height={129}
            className="h-12 w-auto sm:h-14"
            sizes="70px"
          />
        </div>
      </header>
      <section className="relative mx-auto flex w-full max-w-2xl flex-1 flex-col items-start justify-center gap-6 px-4 py-20 sm:px-6">
        <span className="inline-flex size-14 items-center justify-center rounded-[2px] bg-brand text-white">
          <Icon name="check" size={28} />
        </span>
        <h1 className="text-h2 font-extrabold tracking-tight text-balance text-white">
          Thanks. Your roof estimate request is in.
        </h1>
        <p className="max-w-xl text-lg leading-relaxed text-muted">
          A member of the {siteConfig.businessName} team will reach out using
          the details you shared. Want to talk sooner? Give us a call.
        </p>
        <PhoneLink location="thank-you" />
      </section>
    </div>
  );
}
