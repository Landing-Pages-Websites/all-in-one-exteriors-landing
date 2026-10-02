import type { Metadata } from "next";

import { seoRenamed } from "../../lib/seo";

export const metadata: Metadata = seoRenamed({
  description: "Renamed description.",
});

export default function Renamed() {
  return (
    <section id="renamed">
      <h1>Renamed</h1>
    </section>
  );
}
