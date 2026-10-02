import type { Metadata } from "next";

import { seo } from "../../lib/seo";

export const metadata: Metadata = seo({
  title: "Barreled title",
  robots: { index: true },
});

export default function PageBarreled() {
  return (
    <section id="barreled">
      <h1>Barreled</h1>
    </section>
  );
}
