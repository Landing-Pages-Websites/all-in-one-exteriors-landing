import { Detail } from "./Detail";

export function Feature() {
  // A lowercase helper is not a component, and nothing renders it either.
  const promoMarkup = () => (
    <section id="helper">
      <p>Never shown from a helper</p>
    </section>
  );
  return (
    <section id="feature">
      <h2>Rendered feature</h2>
      <Detail />
    </section>
  );
}

// Exported beside a rendered component, and rendered by nothing.
export function UnusedAside() {
  return (
    <section id="aside">
      <p>Never rendered.</p>
    </section>
  );
}
