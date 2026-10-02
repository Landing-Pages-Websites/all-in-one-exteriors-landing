import type { ReactElement } from "react";
import { siteConfig } from "@/site.config";

export interface LegalSection {
  heading: string;
  body: string;
}

export interface LegalPageLayoutProps {
  title: string;
  sections: LegalSection[];
}

/** Shared shell for the scaffolded legal pages (privacy/terms/cookies). */
export function LegalPageLayout({ title, sections }: LegalPageLayoutProps): ReactElement {
  return (
    <article className="mx-auto w-full max-w-2xl px-6 py-16">
      <h1 className="text-3xl font-bold">{title}</h1>
      <p className="mt-2 text-sm text-neutral-500">
        {siteConfig.legalName} ({siteConfig.businessName})
      </p>
      {sections.map((section) => (
        <section key={section.heading} className="mt-8">
          <h2 className="text-xl font-semibold">{section.heading}</h2>
          <p className="mt-2 leading-relaxed text-neutral-700 dark:text-neutral-300">
            {section.body}
          </p>
        </section>
      ))}
    </article>
  );
}
