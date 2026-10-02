import type { Metadata } from "next";

import { seoRobotsAccessor } from "../../lib/seo";

export const metadata: Metadata = seoRobotsAccessor({
  description: "Robots-accessor description.",
});

export default function PageRobotsaccessor() {
  return (
    <section id="robotsaccessor">
      <h1>Robotsaccessor</h1>
    </section>
  );
}
