import type { Metadata } from "next";

import { seoAssignedRobots } from "../../lib/seo";

const index = false;

export const metadata: Metadata = seoAssignedRobots({ index: true });

// `index` here is the route's own constant, NOT the helper's parameter of the
// same name -- so the flag the call supplied may not answer for it.
metadata.robots = { index };

export default function PageAssignsubstituted() {
  return (
    <section id="assignsubstituted">
      <h1>Assignsubstituted</h1>
    </section>
  );
}
