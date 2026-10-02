import type { Metadata } from "next";

import { seoArguments } from "../../lib/seo";

export const metadata: Metadata = seoArguments({
  robots: { index: true },
});

export default function PageArgumentsobj() {
  return (
    <section id="argumentsobj">
      <h1>Argumentsobj</h1>
    </section>
  );
}
