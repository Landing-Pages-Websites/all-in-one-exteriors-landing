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
    body: `TODO_POLICY_CONTENT — describe the agreement between visitors and ${siteConfig.legalName}.`,
  },
  {
    heading: "Services",
    body: "TODO_POLICY_CONTENT — describe the services offered and any disclaimers.",
  },
  {
    heading: "Intellectual Property",
    body: "TODO_POLICY_CONTENT — describe ownership of site content and trademarks.",
  },
  {
    heading: "Limitation of Liability",
    body: "TODO_POLICY_CONTENT — describe liability limits.",
  },
  {
    heading: "Governing Law",
    body: "TODO_POLICY_CONTENT — state the governing jurisdiction.",
  },
  {
    heading: "Contact",
    body: `Questions about these terms? Contact ${siteConfig.businessName} at ${siteConfig.contact.email}.`,
  },
];

export default function TermsPage(): ReactElement {
  return <LegalPageLayout title="Terms of Service" sections={sections} />;
}
