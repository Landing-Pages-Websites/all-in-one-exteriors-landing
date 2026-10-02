import type { Metadata } from "next";

// The same shape in a DIRECT metadata object, which is validated by the same
// reader.
export const metadata: Metadata = {
  description: "Proto-direct description.",
  robots: { __proto__: { index: false } },
};

export default function PageProtodirect() {
  return (
    <section id="protodirect">
      <h1>Protodirect</h1>
    </section>
  );
}
