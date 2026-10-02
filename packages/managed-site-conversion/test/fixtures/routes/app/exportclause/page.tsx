import type { Metadata } from "next";

const pageMetadata: Metadata = {
  title: "Exportclause title",
  robots: { index: false },
};

export { pageMetadata as metadata };

export default function PageExportclause() {
  return (
    <section id="exportclause">
      <h1>Exportclause</h1>
    </section>
  );
}
