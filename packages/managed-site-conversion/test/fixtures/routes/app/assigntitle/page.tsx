import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Overwritten before Next ever reads it",
  description: "Assigntitle description.",
};

metadata.title = "Assigntitle title";

export default function PageAssigntitle() {
  return (
    <section id="assigntitle">
      <h1>Assigntitle</h1>
    </section>
  );
}
