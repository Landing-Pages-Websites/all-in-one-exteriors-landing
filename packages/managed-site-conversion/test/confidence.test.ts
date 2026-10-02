import assert from "node:assert/strict";
import test from "node:test";

import { renderAnchor } from "../src/anchors.js";
import type { Candidate } from "../src/candidates.js";
import { applyConfidenceGate } from "../src/gate.js";
import type { FindingCode } from "../src/report.js";
import { extractModule } from "./support/proposals.js";

interface Outcome {
  readonly accepted: readonly string[];
  readonly findings: readonly FindingCode[];
  readonly candidates: readonly Candidate[];
}

function walk(source: string): Outcome {
  const extracted = extractModule(source);
  const gate = applyConfidenceGate(extracted.candidates);
  return {
    accepted: gate.accepted.map((candidate) => renderAnchor(candidate.anchor)).sort(),
    findings: [...extracted.findings, ...gate.findings].map((finding) => finding.code),
    candidates: extracted.candidates,
  };
}

/**
 * Each case names an adversarial shape and the ONE decision the tool must make.
 * The class under test is "never resolve a tie", not any single example of one.
 */
const AMBIGUITY_CASES: readonly (readonly [string, string, readonly string[]])[] = [
  [
    "identical sibling paragraphs",
    `export function A() {
       return <section id="s"><p>One</p><p>Two</p></section>;
     }`,
    [],
  ],
  [
    "the same constant used for two calls to action",
    `const URL = "https://a.example.com";
     export function A() {
       return <section id="s"><a href={URL}>Top</a><a href={URL}>Bottom</a></section>;
     }`,
    [],
  ],
  [
    "identical paragraphs separated only by wrapper depth",
    `export function A() {
       return <section id="s"><div><div><p>One</p></div></div><p>Two</p></section>;
     }`,
    [],
  ],
  [
    "identical paragraphs in different order",
    `export function A() {
       return <section id="s"><p>Two</p><p>One</p></section>;
     }`,
    [],
  ],
  [
    "one paragraph nested inside an ambiguous twin",
    `export function A() {
       return <section id="s"><p>One <em>emphasis</em></p><p>Two <em>other</em></p></section>;
     }`,
    [],
  ],
  [
    "two differently named components are not a tie",
    `export function A() { return <section id="x"><h2>First</h2></section>; }
     export function B() { return <section id="y"><h2>Second</h2></section>; }`,
    ["component:A/region:x/role:h2/text", "component:B/region:y/role:h2/text"],
  ],
];

test("ties are never resolved, only reported", () => {
  for (const [name, source, expected] of AMBIGUITY_CASES) {
    const outcome = walk(source);
    assert.deepEqual(outcome.accepted, expected, `unexpected acceptance for: ${name}`);
    if (expected.length === 0) {
      assert.ok(
        outcome.findings.includes("AMBIGUOUS_ANCHOR"),
        `no ambiguity reported for: ${name}`,
      );
    }
  }
});

test("a named region separates otherwise identical siblings", () => {
  const outcome = walk(`export function A() {
    return (
      <>
        <section id="first"><p>One</p></section>
        <section id="second"><p>Two</p></section>
      </>
    );
  }`);
  assert.deepEqual(outcome.accepted, [
    "component:A/region:first/role:p/text",
    "component:A/region:second/role:p/text",
  ]);
});

const OWNERSHIP_CASES: readonly (readonly [string, string, string, string])[] = [
  [
    "accessibility labels belong to code",
    `export function A() { return <nav id="n" aria-label="Primary"><a href="#x">X</a></nav>; }`,
    "component:A/region:n/role:nav#aria-label",
    "code_owned_interface",
  ],
  [
    "a self-referential link destination belongs to code",
    `export function A() { return <header id="h"><a href="#">Brand</a></header>; }`,
    "component:A/region:h/role:a/at:#",
    "code_owned_interface",
  ],
  [
    // The fragment is the customer's to rewrite, so it names nothing; the
    // ownership it decides is unchanged. Identity moved, capability did not.
    "a link to a declared fragment is customer content",
    `export function A() { return <header id="h"><a href="#pricing">Pricing</a></header>; }`,
    "component:A/region:h/role:a",
    "customer_editable",
  ],
  [
    "an external destination is customer content",
    `export function A() { return <header id="h"><a href="https://x.example/y">Out</a></header>; }`,
    "component:A/region:h/role:a",
    "customer_editable",
  ],
  [
    "body prose is customer content",
    `export function A() { return <section id="s"><p>Copy.</p></section>; }`,
    "component:A/region:s/role:p/text",
    "customer_editable",
  ],
  [
    "a heading is customer content",
    `export function A() { return <section id="s"><h2>Copy</h2></section>; }`,
    "component:A/region:s/role:h2/text",
    "customer_editable",
  ],
];

test("ownership is decided by role, not by wording", () => {
  for (const [name, source, anchor, expected] of OWNERSHIP_CASES) {
    const outcome = walk(source);
    const candidate = outcome.candidates.find(
      (entry) => renderAnchor(entry.anchor) === anchor,
    );
    assert.ok(candidate !== undefined, `missing candidate for: ${name}`);
    assert.equal(candidate.ownership, expected, `wrong ownership for: ${name}`);
  }
});

const REFUSAL_CASES: readonly (readonly [string, string, FindingCode])[] = [
  [
    "an unnamed section",
    `export function A() { return <section><h2>Heading</h2></section>; }`,
    "NO_DURABLE_ANCHOR",
  ],
  [
    "a computed text child",
    `export function A({ n }: { n: number }) { return <section id="s"><h2>H</h2><p>{n + 1}</p></section>; }`,
    "NON_LITERAL_VALUE",
  ],
  [
    "an attribute whose role is not decidable",
    `export function A() { return <section id="s"><input placeholder="Your email" /></section>; }`,
    "UNKNOWN_ATTRIBUTE_ROLE",
  ],
  [
    "a collection whose items each carry their own image",
    `const ITEMS = [{ name: "A", logo: "/a.png" }, { name: "B", logo: "/b.png" }];
     export function A() {
       return <section id="s">{ITEMS.map((i) => <div key={i.name}><img src={i.logo} alt="Logo" /><span>{i.name}</span></div>)}</section>;
     }`,
    "COLLECTION_ITEM_IMAGE_UNSUPPORTED",
  ],
];

test("what it cannot decide, it refuses and names", () => {
  for (const [name, source, code] of REFUSAL_CASES) {
    const outcome = walk(source);
    assert.ok(outcome.findings.includes(code), `expected ${code} for: ${name}`);
  }
});

test("an id on a leaf tells it apart; an id on a container names a region", () => {
  const outcome = walk(`export function A() {
    return (
      <section id="offer">
        <p id="eyebrow">Small print</p>
        <p id="lede">Big print</p>
        <div id="cards"><p>Only child</p></div>
      </section>
    );
  }`);
  assert.deepEqual(outcome.accepted, [
    "component:A/region:offer/region:cards/role:p/text",
    "component:A/region:offer/role:p/at:eyebrow/text",
    "component:A/region:offer/role:p/at:lede/text",
  ]);
  assert.ok(!outcome.findings.includes("AMBIGUOUS_ANCHOR"));
});

test("decorative subtrees are excluded rather than exposed", () => {
  const outcome = walk(`export function A() {
    return (
      <section id="s">
        <h2>Real</h2>
        <div aria-hidden><p>Decorative</p></div>
        <svg viewBox="0 0 1 1"><title>Chart</title></svg>
      </section>
    );
  }`);
  assert.deepEqual(outcome.accepted, ["component:A/region:s/role:h2/text"]);
});
