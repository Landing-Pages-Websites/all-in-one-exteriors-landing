import { Suspense } from "react";

import { Barrelled } from "@/components";
import { Feature } from "@/components/Feature";

export default function Home() {
  // Declared inside the page and rendered by nothing.
  const UnusedInline = () => (
    <section id="inline">
      <h2>Never shown from the page</h2>
    </section>
  );
  return (
    <main>
      <Feature />
      <Suspense>
        <Barrelled />
      </Suspense>
    </main>
  );
}

// Exported beside the page, and rendered by nothing.
export function UnusedPromo() {
  return (
    <section id="promo">
      <h2>Never rendered</h2>
    </section>
  );
}
