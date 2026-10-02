import type { Metadata } from "next";
import type { ReactElement } from "react";
import { LegalPageLayout, type LegalSection } from "@/components/legal/LegalPageLayout";
import { buildMetadata } from "@/lib/seo";
import { siteConfig } from "@/site.config";

export const metadata: Metadata = buildMetadata({
  title: "Terms of Service",
  description: `Terms of service for ${siteConfig.businessName}.`,
  path: "/terms",
});

const sections: LegalSection[] = [
  {
    heading: "Acceptance of Terms",
    body: `By using this site, you agree to these terms with ${siteConfig.legalName}, doing business as ${siteConfig.businessName}. If you do not agree, please do not use the site.`,
  },
  {
    heading: "Services",
    body: "This site describes our roofing services and lets you request an estimate. Requesting an estimate does not create a contract. Pricing, scope, schedule, and warranty terms are set only in a written agreement signed by you and us after an inspection.",
  },
  {
    heading: "Intellectual Property",
    body: `The text, photos, logos, and design on this site belong to ${siteConfig.businessName} or are used with permission. Manufacturer names and certification marks belong to their owners. Please do not copy or reuse site content without written permission.`,
  },
  {
    heading: "Limitation of Liability",
    body: "Information on this site is provided for general guidance and may change without notice. To the extent allowed by law, we are not liable for losses that come from using this site or relying on its content. Work we perform is governed by your signed agreement.",
  },
  {
    heading: "Governing Law",
    body: "These terms are governed by the laws of the State of Georgia.",
  },
  {
    heading: "Contact",
    body: `Questions about these terms? Contact ${siteConfig.businessName} at ${siteConfig.contact.email}.`,
  },
];

export default function TermsPage(): ReactElement {
  return <LegalPageLayout title="Terms of Service" sections={sections} />;
}
