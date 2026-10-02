import type { Metadata } from "next";

import { seoComputed } from "../../lib/seo";

export const metadata: Metadata = seoComputed({
  description: "Computed description.",
});

export default function PageComputed() {
  return (
    <section id="computed">
      <h1>Computed</h1>
    </section>
  );
}
