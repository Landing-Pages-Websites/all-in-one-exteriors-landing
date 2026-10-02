import { notFound } from "next/navigation";

export function JsxHiddenBody() {
  notFound();
  return (
    <section id="jsx-hidden-body">
      <h1>Markup below a 404</h1>
    </section>
  );
}
