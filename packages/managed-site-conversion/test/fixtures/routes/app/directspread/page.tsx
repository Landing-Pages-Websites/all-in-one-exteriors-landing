import type { Metadata } from "next";

const title = "Route title";
const defaults = { title: "Runtime title" };

// The spread comes AFTER, so Next uses "Runtime title" while a reader taking the
// first matching shorthand would report "Route title".
export const metadata: Metadata = { title, ...defaults };

export default function PageDirectspread() {
  return (
    <section id="directspread">
      <h1>Directspread</h1>
    </section>
  );
}
