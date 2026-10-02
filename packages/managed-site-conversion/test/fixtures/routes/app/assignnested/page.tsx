import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Assignnested title",
  description: "Assignnested description.",
  robots: { index: true, follow: true },
};

metadata.robots.index = false;

export default function PageAssignnested() {
  return (
    <section id="assignnested">
      <h1>Assignnested</h1>
    </section>
  );
}
