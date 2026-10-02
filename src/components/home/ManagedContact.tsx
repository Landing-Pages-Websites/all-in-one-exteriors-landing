import type { ReactElement } from "react";
import { managedSiteFieldAttributesV1 } from "@landing-pages-websites/managed-site-contract";

import { LeadForm } from "@/components/LeadForm";
import { managedHome } from "@/content/managed-site";

export function ManagedContact(): ReactElement {
  const { heading } = managedHome.contact;
  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col items-center gap-6 px-6 pb-24">
      <h2
        className="text-2xl font-semibold"
        {...managedSiteFieldAttributesV1(heading.fieldId)}
      >
        {heading.value}
      </h2>
      <LeadForm />
    </section>
  );
}
