import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Assignelement title",
  description: "Assignelement description.",
  robots: { index: true },
};

// An element access names its key with an expression this reader does not
// evaluate. Only the one written form is read, so this one is refused.
metadata["robots"] = { index: false, follow: false };

export default function PageAssignelement() {
  return (
    <section id="assignelement">
      <h1>Assignelement</h1>
    </section>
  );
}
