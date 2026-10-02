import { notFound } from "next/navigation";

/** Anonymous, and it renders on the other branch. Nothing is proven. */
export default function () {
  if (process.env.ANON_GATED === "off") notFound();
  return (
    <section id="anon-gated">
      <h1>An anonymous page that serves</h1>
    </section>
  );
}
