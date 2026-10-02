import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Assignbranch title",
  description: "Assignbranch description.",
  robots: { index: true },
};

// A write inside a branch may not run at all, so what Next serves depends on a
// condition this reader does not evaluate.
if (process.env["NODE_ENV"] === "production") {
  metadata.robots = { index: false, follow: false };
}

export default function PageAssignbranch() {
  return (
    <section id="assignbranch">
      <h1>Assignbranch</h1>
    </section>
  );
}
