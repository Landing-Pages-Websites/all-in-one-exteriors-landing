import type { Metadata } from "next";

export const pageMetadata: Metadata = {
  title: "Reexported local title",
  robots: { index: true },
};

export { pageMetadata as metadata } from "../../lib/seo";

export default function PageReexported() {
  return (
    <section id="reexported">
      <h1>Reexported</h1>
    </section>
  );
}
