import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Assigncompound title",
  description: "Assigncompound description.",
  robots: { index: true },
};

// A compound assignment READS the existing value to decide what to write, so
// the value is not the one written here.
metadata.robots ??= { index: false, follow: false };

export default function PageAssigncompound() {
  return (
    <section id="assigncompound">
      <h1>Assigncompound</h1>
    </section>
  );
}
