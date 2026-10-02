import type { Metadata } from "next";

const HIDDEN = { index: false };

export const metadata: Metadata = {
  title: "Assignspread title",
  description: "Assignspread description.",
};

metadata.robots = { ...HIDDEN, follow: false };

export default function PageAssignspread() {
  return (
    <section id="assignspread">
      <h1>Assignspread</h1>
    </section>
  );
}
