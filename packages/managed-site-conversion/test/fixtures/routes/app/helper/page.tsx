import type { Metadata } from "next";

import { seo } from "../../lib/seo";

// Metadata built by a helper call. The values are literals HERE, at the call
// site, and the helper hands them straight to the object it returns.
export const metadata: Metadata = seo({
  title: "Helper title",
  description: "Helper description.",
});

export default function Helper() {
  return (
    <section id="helper">
      <h1>Helper</h1>
    </section>
  );
}
