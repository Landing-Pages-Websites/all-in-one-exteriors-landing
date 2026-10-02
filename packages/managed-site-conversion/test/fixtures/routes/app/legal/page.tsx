import type { Metadata } from "next";

const YEAR = 2026;

// A declared title the tool cannot read is not an absent one.
export const metadata: Metadata = {
  title: `Legal ${YEAR}`,
  description: "Legal description.",
};

export default function Legal() {
  return (
    <section id="terms">
      <h1>Legal</h1>
    </section>
  );
}
