import type { Metadata } from "next";

import { seo } from "../../lib/seo";

export const metadata: Metadata = seo({
  title: "Namespaced title",
  robots: { index: true },
});

export default function PageNamespaced() {
  return (
    <section id="namespaced">
      <h1>Namespaced</h1>
    </section>
  );
}
