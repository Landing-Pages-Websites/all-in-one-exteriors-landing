import type { Metadata } from "next";

import { seo } from "../../lib/seo";

export const metadata: Metadata = seo({
  title: "Helperassign title",
  description: "Helperassign description.",
});

// Hiding one route out of a shared helper's shape is why this is read at all.
metadata.robots = { index: false, follow: false };

export default function PageHelperassign() {
  return (
    <section id="helperassign">
      <h1>Helperassign</h1>
    </section>
  );
}
