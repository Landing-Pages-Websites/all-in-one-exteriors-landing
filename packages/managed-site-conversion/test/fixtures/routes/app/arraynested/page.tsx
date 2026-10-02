import type { Metadata } from "next";

import { seoArrayNested } from "../../lib/seo";

export const metadata: Metadata = seoArrayNested({
  title: "Array title",
  description: "Array-nested description.",
});

export default function PageArraynested() {
  return (
    <section id="arraynested">
      <h1>Arraynested</h1>
    </section>
  );
}
