import type { Metadata } from "next";

import { seoRobots } from "../../lib/seo";

const NOINDEX = false;

export const metadata: Metadata = seoRobots({
  index: NOINDEX,
});

export default function PageRobotsname() {
  return (
    <section id="robotsname">
      <h1>Robotsname</h1>
    </section>
  );
}
