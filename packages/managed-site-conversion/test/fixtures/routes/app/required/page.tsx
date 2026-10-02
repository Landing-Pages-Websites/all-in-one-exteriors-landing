import type { Metadata } from "next";

import { seo } from "../../lib/seo";

export const metadata: Metadata = seo({
  title: "Required title",
  robots: { index: true },
});

export default function PageRequired() {
  return (
    <section id="required">
      <h1>Required</h1>
    </section>
  );
}
