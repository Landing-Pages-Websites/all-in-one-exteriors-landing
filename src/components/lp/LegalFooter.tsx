import Link from "next/link";
import type { ReactElement } from "react";
import { siteConfig } from "@/site.config";

/** Legal-only fine print: no link columns, no social, no outbound exits. */
export function LegalFooter(): ReactElement {
  const year = new Date().getFullYear();
  return (
    <footer
      id="footer"
      className="border-t border-line bg-ink pb-28 pt-8 lg:pb-10"
    >
      <div className="mx-auto flex max-w-[1240px] flex-col items-center justify-between gap-3 px-4 text-small font-medium text-muted sm:flex-row sm:px-6">
        <p>
          © {year} {siteConfig.legalName}. {siteConfig.contact.address.street},{" "}
          {siteConfig.contact.address.city}, {siteConfig.contact.address.region}{" "}
          {siteConfig.contact.address.postalCode}.
        </p>
        <p className="flex gap-5">
          <Link
            href="/privacy-policy"
            className="text-white underline-offset-4 hover:text-gold hover:underline"
          >
            Privacy Policy
          </Link>
          <Link
            href="/terms"
            className="text-white underline-offset-4 hover:text-gold hover:underline"
          >
            Terms
          </Link>
        </p>
      </div>
    </footer>
  );
}
