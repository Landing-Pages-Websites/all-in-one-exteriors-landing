import type { Metadata } from "next";

import { seoMemberAlias } from "../../lib/seo";

export const metadata: Metadata = seoMemberAlias({
  robots: { index: true, inner: { index: true } },
});

export default function PageMemberalias() {
  return (
    <section id="memberalias">
      <h1>Memberalias</h1>
    </section>
  );
}
