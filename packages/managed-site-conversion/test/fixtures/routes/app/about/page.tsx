import type { Metadata } from "next";

// Declares a title only, so the layout's description still applies.
export const metadata: Metadata = {
  title: "About title",
};

export default function About() {
  return (
    <section id="about">
      <h1>About</h1>
    </section>
  );
}
