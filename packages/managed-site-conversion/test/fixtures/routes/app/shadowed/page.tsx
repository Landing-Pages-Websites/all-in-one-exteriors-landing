import type { Metadata } from "next";

import { seoShadowed } from "../../lib/seo";

export const metadata: Metadata = seoShadowed({
  description: "Shadowed description.",
});

export default function PageShadowed() {
  return (
    <section id="shadowed">
      <h1>Shadowed</h1>
    </section>
  );
}
