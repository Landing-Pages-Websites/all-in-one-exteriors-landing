import type { Metadata } from "next";

import { seoTwoParams } from "../../lib/seo";

export const metadata: Metadata = seoTwoParams({
    description: "Two-arg description.",
  },
  "extra");

export default function PageTwoargs() {
  return (
    <section id="twoargs">
      <h1>Twoargs</h1>
    </section>
  );
}
