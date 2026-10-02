/**
 * Formatted blocks. Each is ONE rich-text field rather than a field per text
 * run, and each mark renders through the element this file already uses for it,
 * so the converted page differs from this one only by annotations. A line break
 * inside a block is a hard break, drawn through this file's own `<br>`.
 */
export function Story() {
  return (
    <section id="story">
      <h2>
        Custom signage <span className="italic">built around you</span>
      </h2>
      <p>
        We <em>survey</em>, <strong>build <em>and install</em></strong>, then{" "}
        <a
          className="underline"
          href="https://www.northwind.example/work"
          target="_blank"
          rel="noopener"
        >
          show the work
        </a>
        .
      </p>
      <h3>
        Signs that last.
        <br className="hidden sm:block" />
        Crews that <em>stay</em>.
      </h3>
      <button type="button">
        Book a <span className="font-bold">site visit</span>
      </button>
    </section>
  );
}
