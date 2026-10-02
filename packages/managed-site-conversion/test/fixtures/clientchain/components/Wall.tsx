"use client";

import { Deep } from "./Deep";

function Badge({ label }: { label: string }) {
  return <span>{label}</span>;
}

export function Wall() {
  // A component declared INSIDE another, which renders a value of its own. Both
  // declarations' JSX sits within Wall's span, so a containment test cannot
  // tell which function encloses which.
  function Rule() {
    return <p>Fourteen states and counting.</p>;
  }
  return (
    <section>
      <Rule />
      <h2>Every audience has a place.</h2>
      <Badge label="Now lighting up" />
      <Deep />
    </section>
  );
}
