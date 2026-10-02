import type { Metadata } from "next";
import type { ReactElement } from "react";
import { managedSitePageAttributesV1 } from "@landing-pages-websites/managed-site-contract";

import { ManagedContact } from "@/components/home/ManagedContact";
import { ManagedFaq } from "@/components/home/ManagedFaq";
import { ManagedHero } from "@/components/home/ManagedHero";
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
// The schema wants the words; the content module carries the words and the
// identity of the cell they came from. Narrowed here rather than teaching the
// schema builders what a field id is.
const faqSchema = buildFaqSchema(
  managedHome.faq.items.map((item) => ({
    answer: item.answer.value,
    question: item.question.value,
  })),
);

export default function HomePage(): ReactElement {
  return (
    <div className="contents" {...managedSitePageAttributesV1(managedHome.pageId)}>
      <JsonLd data={businessSchema} />
      <JsonLd data={faqSchema} />
      <ManagedHero />
      <ManagedFaq />
      <ManagedContact />
    </div>
  );
}
