import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Evalassign title",
  description: "Evalassign description.",
};

metadata.robots = { index: false, follow: false };

eval("metadata.title = 'Written by eval';");

export default function PageEvalassign() {
  return (
    <section id="evalassign">
      <h1>Evalassign</h1>
    </section>
  );
}
