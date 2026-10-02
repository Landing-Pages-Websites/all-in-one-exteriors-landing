import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Home title",
  description: "Home description.",
};

export default function Home() {
  return (
    <section id="home">
      <h1>Home</h1>
    </section>
  );
}
