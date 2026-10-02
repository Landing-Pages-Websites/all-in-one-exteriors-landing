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
    body: "Cookies are small files a website saves in your browser. Similar technologies, such as local storage and tracking scripts, do the same job. They help a site remember your choices and measure how it is used.",
  },
  {
    heading: "Cookies We Use",
    body: `${siteConfig.businessName} uses analytics and advertising tools, such as Google and Meta, to measure visits and estimate requests from our ads. A call tracking tool shows a tracking phone number so we know which ads lead to calls. We also keep campaign tags from your link so your estimate request is credited to the right ad.`,
  },
  {
    heading: "Managing Your Preferences",
    body: "Use the cookie banner to accept or decline analytics cookies. Your choice is saved in your browser. To change it, clear this site's data in your browser settings and the banner will appear again on your next visit. You can also block cookies in your browser settings.",
  },
  {
    heading: "Contact",
    body: `Questions about cookies? Contact ${siteConfig.businessName} at ${siteConfig.contact.email}.`,
  },
];

export default function CookiePolicyPage(): ReactElement {
  return <LegalPageLayout title="Cookie Policy" sections={sections} />;
}
