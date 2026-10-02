import type { Metadata } from "next";

import { seoAliasAssign } from "../../lib/seo";

export const metadata: Metadata = seoAliasAssign({
  robots: { index: true },
});

export default function PageAliasassign() {
  return (
    <section id="aliasassign">
      <h1>Aliasassign</h1>
    </section>
  );
}
