import type { Metadata } from "next";

import { seoPair } from "../../lib/seo";

export const { metadata }: { metadata: Metadata } = seoPair();

export default function PageDestructured2() {
  return (
    <section id="destructured2">
      <h1>Destructured2</h1>
    </section>
  );
}
