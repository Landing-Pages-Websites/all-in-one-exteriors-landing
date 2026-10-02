import type { Metadata } from "next";

import { seoReturnSideEffect } from "../../lib/seo";

export const metadata: Metadata = seoReturnSideEffect({
  robots: { index: true },
});

export default function PageSideeffect() {
  return (
    <section id="sideeffect">
      <h1>Sideeffect</h1>
    </section>
  );
}
