import type { Metadata } from "next";

import { seoBlockVar } from "../../lib/seo";

export const metadata: Metadata = seoBlockVar({
  description: "Block-var description.",
});

export default function PageBlockvar() {
  return (
    <section id="blockvar">
      <h1>Blockvar</h1>
    </section>
  );
}
