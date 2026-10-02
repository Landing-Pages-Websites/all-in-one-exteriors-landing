import { Chrome } from "@/components/Chrome";

const STEPS = [
  { title: "Ask", body: "We ask the questions your buyers answer." },
  { title: "Publish", body: "We turn the answers into a year of content." },
];

const LOGOS = [
  { name: "Acme", logo: "/logo-acme.png" },
  { name: "Globex", logo: "/logo-globex.png" },
];

export default function Home() {
  return (
    <>
      <Chrome />
      <section id="services">
        <img src="/hero.png" alt="A wide hero image" />
        <div>
          <div>
            <h2>What we do</h2>
          </div>
        </div>
        <p>One survey becomes a year of proof.</p>
        <a href="#contact">Talk to us</a>
      </section>
      <section id="steps">
        <h2>How it works</h2>
        {STEPS.map((step) => (
          <div key={step.title}>
            <h3>{step.title}</h3>
            <p>{step.body}</p>
          </div>
        ))}
      </section>
      <section id="logos">
        <h2>Trusted by</h2>
        {LOGOS.map((entry) => (
          <div key={entry.name}>
            <img src={entry.logo} alt="A partner logo" />
            <span>{entry.name}</span>
          </div>
        ))}
      </section>
      <section>
        <h2>Unnamed</h2>
        <p>First paragraph.</p>
        <p>Second paragraph.</p>
      </section>
    </>
  );
}
