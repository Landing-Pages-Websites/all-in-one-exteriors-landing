import type { Metadata } from "next";

import { seoBranching } from "../../lib/seo";

export const metadata: Metadata = seoBranching({
  description: "Branching description.",
});

export default function Branching() {
  return (
    <section id="branching">
      <h1>Branching</h1>
    </section>
  );
}
