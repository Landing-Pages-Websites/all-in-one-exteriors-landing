import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Protoassignnull title",
  description: "Protoassignnull description.",
};

// The same target with a value that IS plain data, so only the key can refuse it.
metadata.__proto__ = null;

export default function PageProtoassignnull() {
  return (
    <section id="protoassignnull">
      <h1>Protoassignnull</h1>
    </section>
  );
}
