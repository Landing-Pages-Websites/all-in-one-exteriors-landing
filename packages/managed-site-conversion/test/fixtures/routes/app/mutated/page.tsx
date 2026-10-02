import type { Metadata } from "next";

import { seoMutated } from "../../lib/seo";

export const metadata: Metadata = seoMutated({
  robots: { index: true },
});

export default function PageMutated() {
  return (
    <section id="mutated">
      <h1>Mutated</h1>
    </section>
  );
}
