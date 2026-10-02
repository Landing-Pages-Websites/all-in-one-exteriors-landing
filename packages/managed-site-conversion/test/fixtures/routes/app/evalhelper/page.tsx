import type { Metadata } from "next";

import { seoEval } from "../../lib/seo";

export const metadata: Metadata = seoEval({
  robots: { index: true },
});

export default function PageEvalhelper() {
  return (
    <section id="evalhelper">
      <h1>Evalhelper</h1>
    </section>
  );
}
