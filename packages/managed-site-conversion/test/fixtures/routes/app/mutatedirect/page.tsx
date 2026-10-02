import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Mutatedirect title",
  robots: { index: true },
};

// What Next serves is the module object once the module has run, so this is
// the value of `robots` -- not the one the initializer wrote.
metadata.robots = { index: false, follow: false };

export default function PageMutatedirect() {
  return (
    <section id="mutatedirect">
      <h1>Mutatedirect</h1>
    </section>
  );
}
