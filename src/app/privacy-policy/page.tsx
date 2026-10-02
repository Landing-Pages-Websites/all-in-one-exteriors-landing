import type { Metadata } from "next";
import type { ReactElement } from "react";
import { LegalPageLayout, type LegalSection } from "@/components/legal/LegalPageLayout";
import { buildMetadata } from "@/lib/seo";
import { siteConfig } from "@/site.config";

export const metadata: Metadata = buildMetadata({
  title: "Privacy Policy",
  description: `Privacy policy for ${siteConfig.businessName}.`,
  path: "/privacy-policy",
});

const sections: LegalSection[] = [
  {
    heading: "Information We Collect",
    body: `TODO_POLICY_CONTENT — describe what personal information ${siteConfig.businessName} collects (e.g. contact form submissions, analytics data).`,
  },
  {
    heading: "How We Use Your Information",
    body: "TODO_POLICY_CONTENT — describe how collected information is used (responding to inquiries, improving the site, marketing).",
  },
  {
    heading: "Cookies and Analytics",
    body: "TODO_POLICY_CONTENT — describe analytics tools in use and link to the cookie policy.",
  },
  {
    heading: "Data Sharing and Third Parties",
    body: "TODO_POLICY_CONTENT — describe any third parties data is shared with and why.",
  },
  {
    heading: "Your Rights",
    body: "TODO_POLICY_CONTENT — describe access/deletion rights and how to exercise them.",
  },
  {
    heading: "Contact",
    body: `Questions about this policy? Contact ${siteConfig.businessName} at ${siteConfig.contact.email}.`,
  },
];

export default function PrivacyPolicyPage(): ReactElement {
  return <LegalPageLayout title="Privacy Policy" sections={sections} />;
}
