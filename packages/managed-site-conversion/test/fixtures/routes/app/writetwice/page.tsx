import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Writetwice title",
  description: "Writetwice description.",
  robots: { index: true, follow: true },
};

metadata.robots = { index: false, follow: true };
metadata.robots = { index: true, follow: false };

export default function PageWritetwice() {
  return (
    <section id="writetwice">
      <h1>Writetwice</h1>
    </section>
  );
}
