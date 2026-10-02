import type { Metadata } from "next";

import { seoAssign } from "../../lib/seo";

export const metadata: Metadata = seoAssign({
  robots: { index: true },
});

export default function PageAssign() {
  return (
    <section id="assign">
      <h1>Assign</h1>
    </section>
  );
}
