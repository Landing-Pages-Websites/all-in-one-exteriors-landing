import type { Metadata } from "next";

import { seoDefaulted } from "../../lib/seo";

// The call omits `description`, so the helper's own default answers -- and that
// default names a constant only the helper's module can see.
export const metadata: Metadata = seoDefaulted({});

export default function PageDefaulted() {
  return (
    <section id="defaulted">
      <h1>Defaulted</h1>
    </section>
  );
}
