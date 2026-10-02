import type { Metadata } from "next";

import { seo } from "../../lib/seo";

export const metadata: Metadata = seo({
  title: "Mutateeval title",
  robots: { index: true },
});

eval("metadata.robots = { index: false };");

export default function PageMutateeval() {
  return (
    <section id="mutateeval">
      <h1>Mutateeval</h1>
    </section>
  );
}
