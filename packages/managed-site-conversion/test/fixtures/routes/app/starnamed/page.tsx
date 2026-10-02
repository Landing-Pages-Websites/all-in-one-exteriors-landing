import type { Metadata } from "next";

/** Publishes a whole module under the name Next reads. */
export * as metadata from "../../lib/starred-metadata";

const shown: Metadata = { title: "Starnamed title" };
void shown;

export default function PageStarnamed() {
  return (
    <section id="starnamed">
      <h1>Starnamed</h1>
    </section>
  );
}
