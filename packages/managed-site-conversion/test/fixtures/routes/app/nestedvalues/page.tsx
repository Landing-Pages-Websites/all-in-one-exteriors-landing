import type { Metadata } from "next";

import { seoNestedValues } from "../../lib/seo";

export const metadata: Metadata = seoNestedValues({
  title: "Nested title",
  description: "Nested-values description.",
});

export default function PageNestedvalues() {
  return (
    <section id="nestedvalues">
      <h1>Nestedvalues</h1>
    </section>
  );
}
