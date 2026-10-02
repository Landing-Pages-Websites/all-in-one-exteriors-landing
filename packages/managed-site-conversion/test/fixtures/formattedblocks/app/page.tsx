import { Aside } from "../components/Aside";

export default function Home() {
  return (
    <main>
      <section id="story">
        <h2>
          Custom signage <span className="italic text-accent">built around you</span>
        </h2>
        <p>
          We <em>survey</em> and <strong>install</strong>, then{" "}
          <a href="https://example.com/work" target="_blank" rel="noopener">
            show the work
          </a>
          .
        </p>
        <a id="learn" href="https://example.com/learn">
          <span className="italic">Learn</span> more
        </a>
        <a id="plain" href="https://example.com/plain">
          Plain link
        </a>
      </section>
      <section id="terms">
        <ul>
          <li>
            First <em>term</em>
          </li>
          <li>Second term</li>
        </ul>
      </section>
      <Aside />
    </main>
  );
}
