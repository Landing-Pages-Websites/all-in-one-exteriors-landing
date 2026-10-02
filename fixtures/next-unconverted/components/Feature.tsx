import type { ReactNode } from "react";

/** A receiver: the caller's value is rendered as the sole child of a host element. */
export function Feature({
  title,
  lead,
  aside,
}: {
  title: string;
  lead: string;
  aside: ReactNode;
}) {
  return (
    <section>
      <h2>{title}</h2>
      <p>{lead}</p>
      <aside>{aside}</aside>
    </section>
  );
}
