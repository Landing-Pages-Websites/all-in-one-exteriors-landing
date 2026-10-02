import type { Metadata } from "next";
import type { ReactElement } from "react";
import { LegalPageLayout, type LegalSection } from "@/components/legal/LegalPageLayout";
import { buildMetadata } from "@/lib/seo";
import { siteConfig } from "@/site.config";

export const metadata: Metadata = buildMetadata({
  title: "Cookie Policy",
  description: `Cookie policy for ${siteConfig.businessName}.`,
  path: "/cookie-policy",
});

const sections: LegalSection[] = [
  {
    heading: "What Cookies Are",
    body: "TODO_POLICY_CONTENT — brief plain-language explanation of cookies and similar technologies.",
  },
  {
    heading: "Cookies We Use",
    body: `TODO_POLICY_CONTENT — list the analytics cookies ${siteConfig.businessName} uses (Google Analytics, PostHog) and their purposes.`,
  },
  {
    heading: "Managing Your Preferences",
    body: "TODO_POLICY_CONTENT — explain the consent banner choice and how to clear it (clearing browser storage re-prompts).",
  },
  {
    heading: "Contact",
    body: `Questions about cookies? Contact ${siteConfig.businessName} at ${siteConfig.contact.email}.`,
  },
];

export default function CookiePolicyPage(): ReactElement {
  return <LegalPageLayout title="Cookie Policy" sections={sections} />;
}
