import type { Metadata } from "next";

import { seo } from "../../lib/seo";

export const metadata: Metadata = seo({
  title: "Dynamic title",
  robots: { index: true },
});

export default function PageDynamic() {
  return (
    <section id="dynamic">
      <h1>Dynamic</h1>
    </section>
  );
}
