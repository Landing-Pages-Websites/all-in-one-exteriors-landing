import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Protoassign title",
  description: "Protoassign description.",
  robots: { index: true },
};

// `__proto__` written as an assignment target replaces the object's PROTOTYPE,
// so `robots` becomes INHERITED and no scan of own members can find it. Read as
// an ordinary key, the route would publish the `index: true` it overrode.
metadata.__proto__ = { robots: { index: false, follow: false } };

export default function PageProtoassign() {
  return (
    <section id="protoassign">
      <h1>Protoassign</h1>
    </section>
  );
}
