import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Pricing title",
  description: "Pricing description.",
  robots: { index: false, follow: false },
};

export default function Pricing() {
  return (
    <section id="pricing">
      <h1>Pricing</h1>
    </section>
  );
}
