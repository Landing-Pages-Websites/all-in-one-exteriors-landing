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
    heading: "Privacy Policy",
    body: "All In One Exteriors and Construction is committed to protecting online user privacy. Information collected when you use https://allinoneexteriors.com/ or https://services.allinoneexteriors.com/ (together, the “Site”) and respond to Facebook Lead Ads is used only in the manner and for the purposes described in this Privacy Policy.",
  },
  {
    heading: "User Consent to Privacy Policy",
    body: "Any person (a) accessing, browsing, or otherwise using the Site, either manually or via an automated device or program or (b) responding to a Facebook Leads Ad, shall be considered a “User”. All Users are bound by the terms of this Privacy Policy. Users consent to the collection, use, and disclosure of personally identifiable User information (“Information”) pursuant to the terms of this Privacy Policy.",
  },
  {
    heading: "Information Collection and Deletion",
    body: "Most of our services do not require any form of registration. However, some services may require you to provide Personal Data. If you choose to withhold any Personal Data requested by us, it may not be possible for you to gain access to certain parts of the site or for us to respond to your query. We collect and process information you provide when you use the Site or respond to Facebook Lead Ads, including when you create an account; contact us by email, chat, customer review, or customer service; and purchase products or services, including billing and shipping addresses, email, phone numbers, and payment details. The roof estimate form at https://services.allinoneexteriors.com/ collects your first name, last name, email, phone number, and your answers about the home and roof so we can respond to that request. You may request access to the information we have about you. We may ask you to verify your identity and will send a copy electronically unless you request a different method. If information is incorrect, contact us so we can update it. Data that is no longer needed for the purposes in Use of Information will be deleted. You may contact us to ask that information about you be deleted.",
  },
  {
    heading: "Cookies",
    body: "Through cookies, we may collect and store anonymous information relating to browsing patterns, including browser version, site referral information, IP address, operating system, and other technical Site use information. Cookies may be used with session variables to track a shopping cart and expire when an order is completed or a cart sits idle. We do not use cookies to retrieve information from your computer unless you knowingly and willingly provided it. You may set your browser to notify you when you receive a cookie or to prevent cookies from being sent. Blocking cookies may limit Site functionality, especially when purchasing an item.",
  },
  {
    heading: "Use of Information",
    body: "We use the information collected from Users to respond to questions, comments, or requests; administer a contest entry or other promotional feature; fulfill a purchase request and notify Users of order status; and provide important functionality changes to the site, new services, and special offers we think you will find valuable. The text-message program described under SMS / Text Messaging is customer care only and is separate from those special offers.",
  },
  {
    heading: "Disclosure of Information to Third Parties",
    body: "Unless we have your consent or except as required or permitted by law, we will not sell, share, trade, or give away Information collected or received regarding Users. We may disclose information if we have a good faith belief that we are required to do so by law or legal process, to respond to claims, or to protect the rights, property, or safety of All In One Exteriors and Construction or others. We may disclose Information to a third party if that third party acquires the company or its assets.",
  },
  {
    heading: "Linked Internet Web Sites",
    body: "The Site may link to third-party websites not controlled by us. Those sites may collect and disclose information differently. We are not responsible for the collection, use, or disclosure of information through those websites.",
  },
  {
    heading: "Children",
    body: "The Site is not directed towards children under 18 years of age, and we do not knowingly collect any information from children under 18 years of age through the Site or ads.",
  },
  {
    heading: "Security",
    body: "We have security measures to protect against the loss, misuse, and alteration of the Information under our control, including payment information submitted to us. When Users place orders or access account information, the Site uses secure server software (SSL), which encrypts information before it is sent. We make no representations or warranties with regard to the sufficiency of these security measures and are not responsible for actual or consequential damages that result from a lapse in compliance with this Privacy Policy.",
  },
  {
    heading: "Sales or Acquisition",
    body: "If another company acquires All In One Exteriors and Construction or all or part of its assets, we reserve the right to include Information among the assets transferred to the acquiring company.",
  },
  {
    heading: "Applicable Law",
    body: "Information submitted to this Site will be collected, processed, stored, disclosed, and disposed of in accordance with applicable U.S. law. If you are a non-U.S. User, you acknowledge that we may collect and use your Information outside your resident jurisdiction, including storage on servers outside that jurisdiction. By providing Information, you acknowledge that you have read this Privacy Policy, understand it, agree to its terms, and consent to that transfer. If you do not consent, please do not use this Site.",
  },
  {
    heading: "Controller",
    body: "All In One Exteriors and Construction processes personal data as both a processor and a controller. You can contact us at any time to request access to information we have about you, correct it, or delete it.",
  },
  {
    heading: "Amendments to Privacy Policy",
    body: "All In One Exteriors and Construction reserves the right to amend this Privacy Policy periodically.",
  },
  {
    heading: "SMS / Text Messaging",
    body: "All In One Exteriors sends customer-care text messages only when you submit the roof estimate form at https://services.allinoneexteriors.com/ and check the optional SMS consent box. Messages may include inspection scheduling and confirmations, reminders, project updates, and service-related communications. Message frequency varies. Message and data rates may apply. Reply STOP to opt out. Reply HELP for help. Consent is not a condition of purchase. The checkbox is optional and unchecked by default. Providing a telephone number does not opt you in. Visiting the website does not opt you in. Submitting the form without checking the box does not opt you in. START and YES are not a way for a new subscriber to join. They only resubscribe someone who already opted in on this form and later texted STOP. This text program is customer care only. It is separate from any special offers described above. All In One Exteriors does not share, buy, or sell text-messaging originator opt-in data or consent with third parties. Mobile information is not shared with third parties or affiliates for marketing or promotional purposes.",
  },
  {
    heading: "Contact",
    body: "Questions about this Privacy Policy: All In One Exteriors and Construction, 12850 GA-9 #600, Alpharetta, GA 30004. Phone (404) 445-8136.",
  },
];

export default function PrivacyPolicyPage(): ReactElement {
  return <LegalPageLayout title="Privacy Policy" sections={sections} />;
}
