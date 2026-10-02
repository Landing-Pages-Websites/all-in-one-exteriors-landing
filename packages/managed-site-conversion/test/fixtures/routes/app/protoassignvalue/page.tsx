import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Protoassignvalue title",
  description: "Protoassignvalue description.",
  robots: { index: true },
};

// `__proto__` INSIDE the assigned value, rather than as its target. The object
// written here inherits `index: false`, which no scan of its own members sees.
metadata.robots = { __proto__: { index: false }, follow: false };

export default function PageProtoassignvalue() {
  return (
    <section id="protoassignvalue">
      <h1>Protoassignvalue</h1>
    </section>
  );
}
