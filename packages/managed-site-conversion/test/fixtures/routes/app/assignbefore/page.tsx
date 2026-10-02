import type { Metadata } from "next";

metadata.robots = { index: false, follow: false };

export const metadata: Metadata = {
  title: "Assignbefore title",
  description: "Assignbefore description.",
};

export default function PageAssignbefore() {
  return (
    <section id="assignbefore">
      <h1>Assignbefore</h1>
    </section>
  );
}
