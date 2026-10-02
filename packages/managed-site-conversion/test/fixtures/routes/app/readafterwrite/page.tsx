import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Readafterwrite title",
  description: "Readafterwrite description.",
};

metadata.robots = { index: false, follow: false };

export default function PageReadafterwrite() {
  // A READ hands the object to code this reader does not follow.
  const label = String(metadata.title);
  void label;

  return (
    <section id="readafterwrite">
      <h1>Readafterwrite</h1>
    </section>
  );
}
