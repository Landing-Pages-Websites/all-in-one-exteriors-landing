import assert from "node:assert/strict";
import test from "node:test";
import ts from "typescript";

import { findAttribute, literalAttributeValue } from "../src/jsx-facts.js";
import { extractFiles } from "./support/proposals.js";

/**
 * The claim under test: every reader of an attribute sees the value the element
 * EFFECTIVELY receives.
 *
 * JSX applies attributes left to right, so a duplicate name means the last one
 * wins. `findAttribute` returned the first match, and its nine callers all ask
 * the same question — what does this element receive — so one wrong answer was
 * nine wrong answers. Review found it on the host-alias proof, where
 * `<Heading as="h1" as={Card} />` proved a tag that renders a component.
 *
 * TypeScript rejects a duplicate JSX attribute; the PARSER accepts it, and this
 * reader runs over whatever is on disk. So the fixtures here are deliberately
 * code TypeScript would refuse.
 *
 * The rows below are the primitive; the row after them proves a SECOND caller
 * gets the corrected answer, because a test of only the reviewed caller would
 * leave the other eight unproven.
 */
function firstElementIn(source: string): ts.JsxSelfClosingElement {
  const file = ts.createSourceFile("t.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found: ts.JsxSelfClosingElement | null = null;
  const visit = (node: ts.Node): void => {
    if (found !== null) return;
    if (ts.isJsxSelfClosingElement(node)) {
      found = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(file, visit);
  assert.ok(found !== null, `no self-closing JSX in ${source}`);
  return found;
}

const EFFECTIVE_CASES: readonly (readonly [string, string, string | null])[] = [
  ["a single occurrence", `<img src="a.png" />`, "a.png"],
  ["two literals", `<img src="a.png" src="b.png" />`, "b.png"],
  ["three literals", `<img src="a.png" src="b.png" src="c.png" />`, "c.png"],
  // The effective value is not a literal, so nothing can be read from it —
  // which is the answer that keeps a reader from trusting the earlier literal.
  ["a literal then an expression", `<img src="a.png" src={dynamic} />`, null],
  // The other order: the trailing literal IS the value.
  ["an expression then a literal", `<img src={dynamic} src="b.png" />`, "b.png"],
  ["a literal after a spread", `<img src="a.png" {...rest} src="b.png" />`, "b.png"],
];

for (const [why, markup, expected] of EFFECTIVE_CASES) {
  test(`findAttribute returns the effective value with ${why}`, () => {
    const attribute = findAttribute(firstElementIn(markup), "src");
    assert.ok(attribute !== null, `${why}: no attribute found`);
    assert.equal(literalAttributeValue(attribute), expected, why);
  });
}

test("an absent attribute is still null", () => {
  assert.equal(findAttribute(firstElementIn(`<img alt="only" />`), "src"), null);
});

/**
 * A second caller, so the fix is proven at the primitive AND where it is used.
 *
 * `#collectLink` reads `href` through the same helper. A duplicated `href` must
 * record the destination the page actually navigates to; recording the stale
 * one would send a customer's link somewhere they never see in the markup.
 */
test("a link's duplicated href is read from the effective occurrence", () => {
  const extracted = extractFiles(
    {
      "Caller.tsx":
        `export function Caller() {\n` +
        `  return <a href="https://stale.example/" href="https://shown.example/">Click me</a>;\n}\n`,
    },
    "Caller.tsx",
  );
  const destinations = extracted.candidates
    .filter((candidate) => candidate.kind === "link")
    .map((candidate) => JSON.stringify(candidate.kind === "link" ? candidate.destination : null));
  assert.deepEqual(
    destinations,
    ['{"kind":"external","url":"https://shown.example/"}'],
    "the recorded destination must be the one the element receives",
  );
});
