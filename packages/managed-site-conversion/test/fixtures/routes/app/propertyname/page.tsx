import type { Metadata } from "next";

import { seoPropertyName } from "../../lib/seo";

export const metadata: Metadata = seoPropertyName({
  description: "Property-name description.",
});

export default function PagePropertyname() {
  return (
    <section id="propertyname">
      <h1>Propertyname</h1>
    </section>
  );
}
