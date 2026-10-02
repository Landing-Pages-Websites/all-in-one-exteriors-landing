import type { Metadata } from "next";

import { seo as aliasedSeo } from "../../lib/aliased";

export const metadata: Metadata = aliasedSeo({
  description: "Aliased description.",
});

export default function PageAliased() {
  return (
    <section id="aliased">
      <h1>Aliased</h1>
    </section>
  );
}
