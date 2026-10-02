import type { Metadata } from "next";

import { seoDuplicate } from "../../lib/seo";

export const metadata: Metadata = seoDuplicate({
  description: "Duplicate description.",
});

export default function PageDuplicate() {
  return (
    <section id="duplicate">
      <h1>Duplicate</h1>
    </section>
  );
}
