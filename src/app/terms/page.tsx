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
    body: `These terms apply to https://allinoneexteriors.com/ and to https://services.allinoneexteriors.com/. By using this site, you agree to these terms with ${siteConfig.legalName}, doing business as ${siteConfig.businessName}. If you do not agree, please do not use the site.`,
  },
  {
    heading: "Services",
    body: "This site describes our roofing services and lets you request an estimate. Requesting an estimate does not create a contract. Pricing, scope, schedule, and warranty terms are set only in a written agreement signed by you and us after an inspection.",
  },
  {
    heading: "The Information We Collect",
    body: "You may contact us online to ask for information on our services. The types of personally identifiable information that may be collected include name, email address, telephone number, city, state, and zip code. The roof estimate form also collects your answers about the home and roof.",
  },
  {
    heading: "How We Use the Information",
    body: "We may use the information you provide about yourself to respond to your inquiries. We may use non-personally identifiable information to improve the design and content of our site. We may use this information in the aggregate to analyze site usage. We will not use or transfer personally identifiable information in ways unrelated to the ones described here without also providing you an opportunity to opt out of those unrelated uses.",
  },
  {
    heading: "Privacy Options",
    body: "We may on occasion combine information we receive online with outside records to enhance our ability to market products that may be of interest to you. If you prefer not to receive online marketing information from this website, contact us at (404) 445-8136. That marketing is separate from the customer-care text program described below.",
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
    heading: "Third-Party Sites",
    body: "The website may contain links to other sites whose information practices may be different than ours. Visitors should consult the other sites’ privacy notices. We have no control over information submitted to or collected by those third parties.",
  },
  {
    heading: "Cookies",
    body: "We do not use cookies to personally identify you. We may use cookies to understand site usage and to improve the content and offerings on our sites. Cookies, by themselves, do not tell us your email address or other personally identifiable information.",
  },
  {
    heading: "Security",
    body: "We have put in place appropriate physical, electronic, and managerial procedures to safeguard and help prevent unauthorized access, maintain data security, and correctly use the information we collect online.",
  },
  {
    heading: "Governing Law",
    body: "These terms are governed by the laws of the State of Georgia.",
  },
  {
    heading: "SMS / Text Messaging",
    body: "All In One Exteriors sends customer-care text messages only when you submit https://services.allinoneexteriors.com/ and check the optional SMS consent box. Messages may include inspection scheduling and confirmations, reminders, project updates, and service-related communications. Message frequency varies. Message and data rates may apply. Reply STOP to opt out. Reply HELP for help. Consent is not a condition of purchase. The checkbox is optional and unchecked by default. Providing a telephone number does not opt you in. Visiting the website does not opt you in. Submitting the form without checking the box does not opt you in. START and YES are not a way for a new subscriber to join. They only resubscribe someone who already opted in on this form and later texted STOP. All In One Exteriors does not share, buy, or sell text-messaging originator opt-in data or consent with third parties. Mobile information is not shared with third parties or affiliates for marketing or promotional purposes.",
  },
  {
    heading: "Contact",
    body: `Questions about these terms? Contact ${siteConfig.businessName} at ${siteConfig.contact.email}, or call (404) 445-8136. All In One Exteriors and Construction, 12850 GA-9 #600, Alpharetta, GA 30004.`,
  },
];

export default function TermsPage(): ReactElement {
  return <LegalPageLayout title="Terms of Service" sections={sections} />;
}
