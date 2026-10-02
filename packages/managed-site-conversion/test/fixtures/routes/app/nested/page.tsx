import type { Metadata } from "next";

import { seoNested } from "../../lib/seo";

export const metadata: Metadata = seoNested({
  description: "Nested description.",
});

export default function Nested() {
  return (
    <section id="nested">
      <h1>Nested</h1>
    </section>
  );
}
