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
    body: `When you request a roof estimate, ${siteConfig.businessName} collects the details you enter: your name, email address, phone number, and your answers about the home and roof. We also collect basic visit information, such as the page you came from, campaign tags in the link, and device and browser details.`,
  },
  {
    heading: "How We Use Your Information",
    body: "We use your details to contact you about your estimate, schedule an inspection, and follow up on your project. Visit information helps us understand which ads and pages are working so we can improve this site and our advertising.",
  },
  {
    heading: "Cookies and Analytics",
    body: "This site uses cookies and similar technologies for analytics, advertising measurement, and call tracking. Our Cookie Policy explains what they do and how to manage your choice.",
  },
  {
    heading: "Data Sharing and Third Parties",
    body: "We do not sell your personal information. We share it only with service providers that help us run this site and respond to you, such as our lead management, analytics, advertising, and call tracking providers, and only for those purposes.",
  },
  {
    heading: "Your Rights",
    body: `You can ask us what personal information we hold about you, ask us to correct or delete it, or ask us to stop contacting you. Email ${siteConfig.contact.email} or call ${siteConfig.contact.phone} and we will respond within a reasonable time.`,
  },
  {
    heading: "Contact",
    body: `Questions about this policy? Contact ${siteConfig.businessName} at ${siteConfig.contact.email}.`,
  },
];

export default function PrivacyPolicyPage(): ReactElement {
  return <LegalPageLayout title="Privacy Policy" sections={sections} />;
}
