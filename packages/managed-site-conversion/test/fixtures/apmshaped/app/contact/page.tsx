import type { Metadata } from "next";

import { Cta } from "@/components/Cta";

export const metadata: Metadata = {
  title: "Contact",
  description: "Reach the shop by phone or email.",
};

export default function Contact() {
  return (
    <main>
      <h1>Contact</h1>
      <p>We answer the phone.</p>
      <a href="tel:+15555550100">Call the shop</a>
      <Cta />
    </main>
  );
}
