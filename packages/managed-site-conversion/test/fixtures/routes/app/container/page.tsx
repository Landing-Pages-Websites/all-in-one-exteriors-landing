import type { Metadata } from "next";

import { seoContainer } from "../../lib/seo";

export const metadata: Metadata = seoContainer({
  robots: { index: true },
});

export default function PageContainer() {
  return (
    <section id="container">
      <h1>Container</h1>
    </section>
  );
}
