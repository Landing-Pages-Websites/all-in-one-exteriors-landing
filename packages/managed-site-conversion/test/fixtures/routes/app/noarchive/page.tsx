import type { Metadata } from "next";

import { seoNoarchive } from "../../lib/seo";

export const metadata: Metadata = seoNoarchive({
  description: "Noarchive description.",
});

export default function PageNoarchive() {
  return (
    <section id="noarchive">
      <h1>Noarchive</h1>
    </section>
  );
}
