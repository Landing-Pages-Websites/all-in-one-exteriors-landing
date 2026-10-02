import type { Metadata } from "next";

import { seoDestructured } from "../../lib/seo";

export const metadata: Metadata = seoDestructured({
  description: "Destructured description.",
});

export default function PageDestructured() {
  return (
    <section id="destructured">
      <h1>Destructured</h1>
    </section>
  );
}
