import type { Metadata } from "next";

import { seoReassigned } from "../../lib/seo";

export const metadata: Metadata = seoReassigned({
  description: "Reassigned description.",
});

export default function PageReassigned() {
  return (
    <section id="reassigned">
      <h1>Reassigned</h1>
    </section>
  );
}
