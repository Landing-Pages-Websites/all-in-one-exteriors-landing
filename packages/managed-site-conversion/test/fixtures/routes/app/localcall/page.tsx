import type { Metadata } from "next";

import { seoLocalCall } from "../../lib/seo";

export const metadata: Metadata = seoLocalCall({
  description: "Local-call description.",
});

export default function PageLocalcall() {
  return (
    <section id="localcall">
      <h1>Localcall</h1>
    </section>
  );
}
