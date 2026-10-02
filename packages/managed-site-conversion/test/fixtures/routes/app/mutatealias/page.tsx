import type { Metadata } from "next";

import { seo } from "../../lib/seo";

export const metadata: Metadata = seo({
  title: "Mutatealias title",
  robots: { index: true },
});

const alias = metadata;
Reflect.set(alias, "robots", { index: false });

export default function PageMutatealias() {
  return (
    <section id="mutatealias">
      <h1>Mutatealias</h1>
    </section>
  );
}
