import type { Metadata } from "next";

import { seoSuppliedRobots } from "../../lib/seo";

const index = false;

// `index` inside the robots object is this module's constant, not the helper's
// parameter of the same name.
export const metadata: Metadata = seoSuppliedRobots({ index: true, robots: { index } });

export default function PageSuppliedrobots() {
  return (
    <section id="suppliedrobots">
      <h1>Suppliedrobots</h1>
    </section>
  );
}
