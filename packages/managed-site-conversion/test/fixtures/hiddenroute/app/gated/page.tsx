import { notFound } from "next/navigation";

/** A real page that 404s on one branch. It renders markup on the other. */
export default function Gated() {
  if (process.env.GATED === "off") notFound();
  return (
    <section id="gated">
      <h1>A page with a gate in front of it</h1>
    </section>
  );
}
