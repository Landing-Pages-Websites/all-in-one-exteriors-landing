import siteContent from "./content/site.json";

/**
 * Layer 2 — site configuration.
 *
 * Operational deployment and lead settings for a customer site. Authored page
 * content and protected SEO fields live under src/content/. Every `TODO_`
 * sentinel is enforced by `npm run check-config` and the prebuild hook.
 *
 * Tracking IDs (GA4, PostHog, etc.) do NOT live here — they are env
 * vars minted later by the provisioning bot. See .env.example.
 */

export interface SiteAddress {
  street: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
}

export interface SiteContact {
  phone: string;
  email: string;
  address: SiteAddress;
}

export interface SocialLink {
  label: string;
  url: string;
}

export type SchemaType = "LocalBusiness" | "Organization";

export interface BudgetQualifier {
  /** Price-anchoring statement, e.g. "Our kitchen remodels start at $25,000." */
  priceAnchor: string;
  /** The yes/no question shown after the anchor, e.g. "Is this within your budget?" */
  question: string;
}

export interface SiteConfig {
  /** Public-facing brand name, e.g. "Acme Plumbing". */
  businessName: string;
  /** Registered legal entity name, e.g. "Acme Plumbing LLC". */
  legalName: string;
  /** Bare production domain, no protocol or trailing slash, e.g. "example.com". */
  domain: string;
  /** One-to-two sentence description used for SEO meta + llms.txt. */
  description: string;
  contact: SiteContact;
  /** LocalBusiness for physical/service-area businesses; Organization otherwise. */
  schemaType: SchemaType;
  /** Cities/regions served, e.g. ["Austin, TX", "Round Rock, TX"]. */
  serviceAreas: string[];
  socialLinks: SocialLink[];
  /** Path under /public, e.g. "/logo.png". */
  logoPath: string;
  /** Path under /public, 1200x630, e.g. "/og-image.png". */
  ogImagePath: string;
  /** Customer UUID from MEGA Admin. */
  megaCustomerId: string;
  /** Site UUID from MEGA Admin Conversions tab. */
  megaSiteId: string;
  /** MegaTag site key (sk_…) from MEGA Admin Conversions tab — required for the optimizer to function. */
  megaSiteKey: string;
  /**
   * Lead source identifier sent with every submission. The `website-` prefix
   * distinguishes website leads from ad/LP leads in Keystone.
   */
  sourceProvider: string;
  /**
   * Every form this site has, one immutable key each.
   *
   * `form_key` is how MEGA tells one of the site's forms from another: it names
   * the row in the form registry, it is what per-form email and SMS routing
   * matches on, and it is what the notification subject says the lead came
   * from. A site that declares nothing gets one `contact-form` bucket and
   * routing cannot tell a quote request from a job application.
   *
   * `contact-form` is first and is what `<LeadForm />` sends unless told
   * otherwise, so an existing site keeps the registry row and routing rule it
   * already has. ADD keys for additional forms; never rename one, because that
   * orphans its row and rule. Change the display name in MEGA instead.
   */
  formKeys: readonly string[];
  /**
   * Whether the lead form offers file attachments.
   *
   * Off unless a site deliberately turns it on. Attachments depend on MEGA's
   * scanned upload storage, and a visitor who attaches a document expects it to
   * reach someone — better to not offer the field than to offer one that
   * silently drops files.
   */
  uploadsEnabled?: boolean;
  /**
   * Budget qualifying question rendered as yes/no toggles in the lead form.
   * Set to null to hide the budget toggles for sites where it doesn't fit.
   */
  budgetQualifier: BudgetQualifier | null;
  /** Where the lead form redirects after a successful submit. */
  thankYouPath: string;
  /** BCP 47 locale, drives <html lang> and OG locale. */
  locale: string;
  /**
   * Cookie-consent behavior.
   * - "us-default": analytics load immediately; the banner is informational
   *   ("Got it" / "Decline") and Decline is an opt-out. The norm for US
   *   clients (CCPA is opt-out-based) — no data loss from banner-ignorers.
   * - "strict": nothing loads until the visitor clicks Accept (GDPR-style
   *   opt-in). Use for customers with meaningful EU traffic.
   */
  consentMode: "us-default" | "strict";
}

export const siteConfig: SiteConfig = {
  businessName: siteContent.identity.displayName,
  legalName: siteContent.identity.legalName,
  domain: "TODO_DOMAIN.example.com",
  description: siteContent.identity.description,
  contact: {
    phone: siteContent.identity.telephone,
    email: siteContent.identity.email,
    address: {
      street: siteContent.identity.postalAddress.streetAddress,
      city: siteContent.identity.postalAddress.addressLocality,
      region: siteContent.identity.postalAddress.addressRegion,
      postalCode: siteContent.identity.postalAddress.postalCode,
      country: siteContent.identity.postalAddress.addressCountry,
    },
  },
  schemaType: "LocalBusiness",
  serviceAreas: ["TODO_SERVICE_AREA"],
  socialLinks: siteContent.identity.sameAs.map((url, index) => ({
    label: `Profile ${index + 1}`,
    url,
  })),
  logoPath: "/logo.png",
  ogImagePath: "/og-image.png",
  megaCustomerId: "TODO_MEGA_CUSTOMER_ID",
  megaSiteId: "TODO_MEGA_SITE_ID",
  megaSiteKey: "TODO_MEGA_SITE_KEY",
  sourceProvider: "website-TODO_SOURCE_SLUG",
  formKeys: ["contact-form"],
  uploadsEnabled: false,
  budgetQualifier: {
    priceAnchor: "TODO_PRICE_ANCHOR — e.g. 'Our projects start at $X,XXX.'",
    question: "Is this within your budget?",
  },
  thankYouPath: "/thank-you",
  locale: "en-US",
  consentMode: "us-default",
};
