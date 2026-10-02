import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Protoassignelement title",
  description: "Protoassignelement description.",
  robots: { index: true },
};

// The same write spelled as an element access, which names the key just as well.
metadata["__proto__"] = { robots: { index: false, follow: false } };

export default function PageProtoassignelement() {
  return (
    <section id="protoassignelement">
      <h1>Protoassignelement</h1>
    </section>
  );
}
