import type { Metadata } from "next";

import { seoProtoRobots } from "../../lib/seo";

export const metadata: Metadata = seoProtoRobots({
  description: "Proto-robots description.",
});

export default function PageProtorobots() {
  return (
    <section id="protorobots">
      <h1>Protorobots</h1>
    </section>
  );
}
