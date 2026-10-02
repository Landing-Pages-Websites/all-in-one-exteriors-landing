import type { Metadata } from "next";
import type { ReactElement } from "react";
import { managedSitePageAttributesV1 } from "@landing-pages-websites/managed-site-contract";

import { Benefits } from "@/components/lp/Benefits";
import { Faq } from "@/components/lp/Faq";
import { FinalCta } from "@/components/lp/FinalCta";
import { FloatingCta } from "@/components/lp/FloatingCta";
import { Hero } from "@/components/lp/Hero";
import { LegalFooter } from "@/components/lp/LegalFooter";
import { Offers } from "@/components/lp/Offers";
import { Process } from "@/components/lp/Process";
import { ServiceArea } from "@/components/lp/ServiceArea";
import { Services } from "@/components/lp/Services";
import { SiteHeader } from "@/components/lp/SiteHeader";
import { Testimonials } from "@/components/lp/Testimonials";
import { TrustBar } from "@/components/lp/TrustBar";
import { FAQ_ITEMS } from "@/components/lp/content";
import { JsonLd } from "@/components/schema/JsonLd";
import { buildBusinessSchema, buildFaqSchema } from "@/components/schema/builders";
import { managedHome } from "@/content/managed-site";
import { buildMetadata } from "@/lib/seo";

const { identity, metadata: seo } = managedHome.seo;

export const metadata: Metadata = buildMetadata({
  title: seo.title,
  description: seo.description,
  siteName: identity.displayName,
  path: seo.canonical,
  robots: {
    index: seo.indexing.index,
    follow: seo.indexing.follow,
    noarchive: !seo.indexing.archive,
    noimageindex: !seo.indexing.imageIndex,
    "max-snippet": seo.indexing.maxSnippet,
    "max-image-preview": seo.indexing.maxImagePreview,
    "max-video-preview": seo.indexing.maxVideoPreview,
  },
});

const businessSchema = buildBusinessSchema(identity);
const faqSchema = buildFaqSchema(
  FAQ_ITEMS.map((item) => ({ question: item.question, answer: item.answer })),
);

/** Meta roof-replacement LP: promise, picture, proof, push. */
export default function HomePage(): ReactElement {
  return (
    <div className="contents" {...managedSitePageAttributesV1(managedHome.pageId)}>
      <JsonLd data={businessSchema} />
      <JsonLd data={faqSchema} />
      <SiteHeader />
      <Hero />
      <TrustBar />
      <Benefits />
      <Process />
      <Services />
      <Testimonials />
      <Offers />
      <ServiceArea />
      <Faq />
      <FinalCta />
      <LegalFooter />
      <FloatingCta />
    </div>
  );
}
