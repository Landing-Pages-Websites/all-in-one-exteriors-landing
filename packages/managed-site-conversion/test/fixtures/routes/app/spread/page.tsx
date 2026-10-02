import type { Metadata } from "next";

import { seoWithDefault } from "../../lib/seo";

// The helper decides the description itself, so the call site supplies only a
// title. The description is still a literal, just one declared a layer in.
export const metadata: Metadata = seoWithDefault({
  title: "Spread title",
});

export default function Spread() {
  return (
    <section id="spread">
      <h1>Spread</h1>
    </section>
  );
}
