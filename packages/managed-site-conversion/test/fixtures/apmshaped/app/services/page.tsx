import type { Metadata } from "next";

import { Cta } from "@/components/Cta";

export const metadata: Metadata = {
  title: "Services",
  description: "Every service we install, start to finish.",
};

export default function Services() {
  return (
    <main>
      <h1>Services</h1>
      <p>Storefront signs, channel letters and monuments.</p>
      <a href="/contact">Ask for a quote</a>
      <Cta />
    </main>
  );
}
