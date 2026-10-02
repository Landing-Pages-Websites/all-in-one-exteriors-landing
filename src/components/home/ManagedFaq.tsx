import type { ReactElement } from "react";
import { managedSiteFieldAttributesV1 } from "@landing-pages-websites/managed-site-contract";

import { managedHome } from "@/content/managed-site";

export function ManagedFaq(): ReactElement {
  const { heading, items } = managedHome.faq;
  return (
    <section className="mx-auto w-full max-w-3xl px-6 pb-16">
      <h2
        className="text-2xl font-semibold"
        {...managedSiteFieldAttributesV1(heading.fieldId)}
      >
        {heading.value}
      </h2>
      <dl className="mt-6 space-y-6">
        {items.map((item) => (
          <div key={item.itemId}>
            <dt
              className="font-medium"
              {...managedSiteFieldAttributesV1(item.question.fieldId, item.itemId)}
            >
              {item.question.value}
            </dt>
            <dd
              className="mt-1 text-neutral-600 dark:text-neutral-400"
              {...managedSiteFieldAttributesV1(item.answer.fieldId, item.itemId)}
            >
              {item.answer.value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
