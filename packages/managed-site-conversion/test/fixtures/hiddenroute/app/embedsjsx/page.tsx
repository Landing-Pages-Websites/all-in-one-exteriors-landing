import { JsxHiddenBody } from "@/components/JsxHiddenBody";

/** The page serves. The component it renders 404s, so its words are not ours. */
export default function EmbedsJsx() {
  return (
    <section id="embeds-jsx">
      <h1>A page that embeds a JSX-bearing gate</h1>
      <JsxHiddenBody />
    </section>
  );
}
