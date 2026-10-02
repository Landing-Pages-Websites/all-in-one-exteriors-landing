import type { Metadata } from "next";

import { seoInherited } from "../../lib/seo";

// `__proto__` sets the prototype, so destructuring reads an INHERITED
// `description` that no own key supplies.
export const metadata: Metadata = seoInherited({
  __proto__: { description: "Runtime description." },
});

export default function PageInherited() {
  return (
    <section id="inherited">
      <h1>Inherited</h1>
    </section>
  );
}
