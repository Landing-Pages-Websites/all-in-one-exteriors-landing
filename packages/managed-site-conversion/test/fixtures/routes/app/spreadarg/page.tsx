import type { Metadata } from "next";

import { seo } from "../../lib/seo";

// A spread in the argument may supply `description` itself, and which one wins
// depends on an object this reader has not read. The helper is otherwise the
// clean one, so only the spread can refuse this.
const base = { title: "Base title", description: "From the spread." };

export const metadata: Metadata = seo({
  ...base,
  title: "Spread title",
});

export default function PageSpreadarg() {
  return (
    <section id="spreadarg">
      <h1>Spreadarg</h1>
    </section>
  );
}
