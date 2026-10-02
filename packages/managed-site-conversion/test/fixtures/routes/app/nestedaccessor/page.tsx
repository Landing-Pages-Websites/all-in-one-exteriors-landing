import type { Metadata } from "next";

import { seoNestedAccessor } from "../../lib/seo";

export const metadata: Metadata = seoNestedAccessor({
  description: "Nested-accessor description.",
});

export default function PageNestedaccessor() {
  return (
    <section id="nestedaccessor">
      <h1>Nestedaccessor</h1>
    </section>
  );
}
