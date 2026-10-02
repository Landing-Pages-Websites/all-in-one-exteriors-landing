import type { Metadata } from "next";

import { seoRest } from "../../lib/seo";

export const metadata: Metadata = seoRest({
  description: "Rest description.",
});

export default function PageRest() {
  return (
    <section id="rest">
      <h1>Rest</h1>
    </section>
  );
}
