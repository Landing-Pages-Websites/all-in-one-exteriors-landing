import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { applyRewrite, planRewrite } from "../src/rewire.js";
import { configFor, run, workspace } from "./support/proposals.js";

/**
 * The claim under test: a value a receiver does not render itself, but READS
 * inside another component's prop, is annotated where it is read.
 *
 * All Points Media's headings all arrive this way -- `<TextReveal lines={[title]} />`
 * -- and every one of them was refused for having no host element to annotate.
 * There is nothing to change downstream: the prop takes a node, so the
 * annotated wrapper IS the node the receiver renders.
 *
 * Which props may be wrapped is the whole of the safety here, so the fixture
 * states the adversarial case beside the good one: the same tag also takes a
 * `tooltip` declared `string` and rendered into an attribute, and a rule that
 * looked only at "the value is read inside a prop" would put a `<span>` where
 * the DOM needs text. The DECLARED type decides, not the shape of the read.
 */
const RUNTIME = "@/src/content/managed-site";

function rewritten(): { readonly finalCta: string } {
  const space = workspace("nodeprop", configFor(["/"]));
  applyRewrite(planRewrite(run(space), RUNTIME), RUNTIME);
  return {
    finalCta: readFileSync(
      join(space.repositoryRoot, "components/FinalCta.tsx"),
      "utf8",
    ),
  };
}

const files = rewritten();

test("a node-taking prop gets the annotation around the read", () => {
  assert.match(
    files.finalCta,
    /lines=\{\[headingAttributes === undefined \? \(/u,
    `the heading must be annotated where it is read:\n${files.finalCta}`,
  );
  assert.match(
    files.finalCta,
    /<span \{\.\.\.headingAttributes\}>\{heading\}<\/span>/u,
    `the wrapper is the node the receiver renders:\n${files.finalCta}`,
  );
});

test("a prop declared string on the same tag is left alone", () => {
  assert.match(
    files.finalCta,
    /tooltip=\{tooltip\}/u,
    `an element cannot go where the DOM needs text:\n${files.finalCta}`,
  );
});

test("the receiver still takes the annotation as an optional prop", () => {
  assert.match(
    files.finalCta,
    /headingAttributes\?: ManagedSiteFieldAttributesV1;/u,
  );
  assert.equal(
    files.finalCta.match(/headingAttributes === undefined/gu)?.length,
    1,
    `exactly one read is wrapped:\n${files.finalCta}`,
  );
});
