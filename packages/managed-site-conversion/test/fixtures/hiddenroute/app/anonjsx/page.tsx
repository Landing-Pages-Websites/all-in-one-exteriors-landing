import { notFound } from "next/navigation";

/** Anonymous AND JSX-bearing, which is both gaps in one route. */
export default function () {
  notFound();
  return (
    <section id="anon-jsx">
      <h1>Also unreachable</h1>
    </section>
  );
}
