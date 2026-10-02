import { notFound } from "next/navigation";

/** It writes JSX, and no request ever reaches it. The 404 comes first. */
export default function JsxHidden() {
  notFound();
  return (
    <section id="jsx-hidden">
      <h1>Markup nobody can see</h1>
    </section>
  );
}
