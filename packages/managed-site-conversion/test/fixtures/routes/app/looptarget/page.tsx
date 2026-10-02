import type { Metadata } from "next";

import { seoLoopTarget } from "../../lib/seo";

export const metadata: Metadata = seoLoopTarget({
  robots: { index: true },
});

export default function PageLooptarget() {
  return (
    <section id="looptarget">
      <h1>Looptarget</h1>
    </section>
  );
}
