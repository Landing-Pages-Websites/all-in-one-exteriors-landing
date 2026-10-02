import type { Metadata } from "next";

const DESCRIPTION = "Identifier description.";

export const metadata: Metadata = {
  description: DESCRIPTION,
};

export default function PageIdentifier() {
  return (
    <section id="identifier">
      <h1>Identifier</h1>
    </section>
  );
}
