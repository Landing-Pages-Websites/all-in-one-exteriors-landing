import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Assigncall title",
  description: "Assigncall description.",
};

function hiddenRobots(): Metadata["robots"] {
  return { index: false, follow: false };
}

metadata.robots = hiddenRobots();

export default function PageAssigncall() {
  return (
    <section id="assigncall">
      <h1>Assigncall</h1>
    </section>
  );
}
