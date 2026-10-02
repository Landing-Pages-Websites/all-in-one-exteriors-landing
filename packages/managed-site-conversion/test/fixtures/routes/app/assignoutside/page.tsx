import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Assignoutside title",
  description: "Assignoutside description.",
  robots: { index: false, follow: false },
};

// A TOP-LEVEL key that happens to share a name with a robots flag. An
// assignment to `metadata.index` is not an assignment to `robots.index`, so
// the nested object must not be read under the outer object's writes.
// @ts-expect-error -- not a Next.js metadata key, which is the point of it.
metadata.index = true;

export default function PageAssignoutside() {
  return (
    <section id="assignoutside">
      <h1>Assignoutside</h1>
    </section>
  );
}
