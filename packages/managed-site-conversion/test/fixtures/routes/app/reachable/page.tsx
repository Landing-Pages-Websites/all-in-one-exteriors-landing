import type { Metadata } from "next";

import { seo } from "../../lib/seo";
import { rewrite } from "../../lib/rewrite";

export const metadata: Metadata = seo({
  title: "Reachable title",
  robots: { index: true },
});

rewrite();

export default function PageReachable() {
  return (
    <section id="reachable">
      <h1>Reachable</h1>
    </section>
  );
}
