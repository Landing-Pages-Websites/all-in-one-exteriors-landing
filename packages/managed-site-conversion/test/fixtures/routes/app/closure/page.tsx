import type { Metadata } from "next";

import { seoClosure } from "../../lib/seo";

export const metadata: Metadata = seoClosure({
  description: "Closure description.",
});

export default function PageClosure() {
  return (
    <section id="closure">
      <h1>Closure</h1>
    </section>
  );
}
