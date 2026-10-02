import type { Metadata } from "next";

import { seo } from "../../lib/seo";

export const metadata: Metadata = seo({
  title: "Mutateassign title",
  robots: { index: true },
});

Object.assign(metadata, { robots: { index: false } });

export default function PageMutateassign() {
  return (
    <section id="mutateassign">
      <h1>Mutateassign</h1>
    </section>
  );
}
