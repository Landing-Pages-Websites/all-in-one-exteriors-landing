import type { Metadata } from "next";

import { seoAccessor } from "../../lib/seo";

export const metadata: Metadata = seoAccessor({
  description: "Accessor description.",
});

export default function PageAccessor() {
  return (
    <section id="accessor">
      <h1>Accessor</h1>
    </section>
  );
}
