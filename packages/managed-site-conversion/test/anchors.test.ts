import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { renderAnchor } from "../src/anchors.js";
import { extractModule } from "./support/proposals.js";

function anchorsOf(source: string): readonly string[] {
  return extractModule(source)
    .candidates.map((candidate) => renderAnchor(candidate.anchor))
    .sort();
}

/**
 * The identity claim under test: an anchor is made of names a developer wrote.
 * Presentation churn — wrapping, reordering, restyling, rewording — must not
 * move it. Renaming a component must.
 */
const BASELINE = `
export function Panel() {
  return (
    <section id="offer">
      <h2>Original heading</h2>
      <a href="#contact">Talk to us</a>
    </section>
  );
}
`;

const REFACTORS: readonly (readonly [string, string])[] = [
  [
    "extra layout wrappers",
    `
export function Panel() {
  return (
    <section id="offer">
      <div className="grid">
        <div className="col">
          <h2>Original heading</h2>
        </div>
      </div>
      <div><a href="#contact">Talk to us</a></div>
    </section>
  );
}
`,
  ],
  [
    "reordered siblings",
    `
export function Panel() {
  return (
    <section id="offer">
      <a href="#contact">Talk to us</a>
      <h2>Original heading</h2>
    </section>
  );
}
`,
  ],
  [
    "rewritten copy and restyled",
    `
export function Panel() {
  return (
    <section id="offer" className="mt-12 bg-white">
      <h2 className="text-4xl">A completely different heading</h2>
      <a href="#contact" className="btn">Book a call instead</a>
    </section>
  );
}
`,
  ],
  [
    "section element swapped for an article",
    `
export function Panel() {
  return (
    <article id="offer">
      <h2>Original heading</h2>
      <a href="#contact">Talk to us</a>
    </article>
  );
}
`,
  ],
];

test("anchors survive presentation-only refactors", () => {
  const baseline = anchorsOf(BASELINE);
  assert.deepEqual(baseline, [
    "component:Panel/region:offer/role:a",
    "component:Panel/region:offer/role:h2/text",
  ]);
  for (const [name, source] of REFACTORS) {
    assert.deepEqual(anchorsOf(source), baseline, `refactor changed anchors: ${name}`);
  }
});

test("renaming a component moves its anchors, visibly", () => {
  const renamed = anchorsOf(BASELINE.replaceAll("Panel", "OfferPanel"));
  assert.deepEqual(renamed, [
    "component:OfferPanel/region:offer/role:a",
    "component:OfferPanel/region:offer/role:h2/text",
  ]);
});

/**
 * A destination the customer may edit is not identity — a fragment included.
 * `link.destination.edit` rewrites `#services` exactly as it rewrites an
 * external URL, so only the module constant's NAME survives: the customer
 * changes the value behind `BOOK_URL`, never the name the markup reads it
 * through. `editable-anchor-material.test.ts` states the rule for every value
 * this tool proposes; this pins it for the shape a real nav has.
 */
test("only a name the customer cannot edit tells sibling links apart", () => {
  const anchors = anchorsOf(`
const BOOK_URL = "https://book.example.com";
export function Links() {
  return (
    <nav id="links">
      <a href="#services">Services</a>
      <a href={BOOK_URL}>Book</a>
      <a href="https://news.example.com/story">Read</a>
      <a href="#">Brand</a>
    </nav>
  );
}
`);
  assert.deepEqual(anchors, [
    "component:Links/region:links/role:a",
    "component:Links/region:links/role:a",
    "component:Links/region:links/role:a/at:#",
    "component:Links/region:links/role:a/at:const:BOOK_URL",
  ]);
});

test("changing only the external URL leaves every anchor alone", () => {
  const before = anchorsOf(`
export function Promo() {
  return (
    <section id="promo">
      <a href="https://old.example.com/a">Read the report</a>
    </section>
  );
}
`);
  const after = anchorsOf(`
export function Promo() {
  return (
    <section id="promo">
      <a href="https://new.example.com/b">Read the report</a>
    </section>
  );
}
`);
  assert.deepEqual(after, before);
});

test("json pointers never collide with the values nested inside them", async () => {
  const directory = mkdtempSync(join(tmpdir(), "managed-site-pointer-"));
  mkdirSync(join(directory, "app"), { recursive: true });
  writeFileSync(
    join(directory, "app", "page.tsx"),
    `export default function Home() {
  return (
    <section id="brand">
      <a href="#"><h3>Trend</h3><p>Candy</p></a>
    </section>
  );
}
`,
    "utf8",
  );
  const { propose } = await import("../src/propose.js");
  const proposal = propose({
    repositoryRoot: directory,
    configPath: null,
    ledgerPath: join(directory, "idmap.json"),
  });
  const pointers = proposal.report.proposedFieldCount;
  assert.equal(pointers, 3);
});
