import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { applyRewrite, planRewrite } from "../src/rewire.js";
import { configFor, run, workspace } from "./support/proposals.js";

/**
 * The claim under test: a value handed to a component that hands it to ANOTHER
 * component still arrives, annotated, at the host element a reader sees.
 *
 * `FeatureRow` puts its `eyebrow` inside `<Eyebrow>`, which puts its children
 * inside a span beside a decorative rule. Every link in that chain takes the
 * annotation as a prop and passes it on. Stopping at the first receiver -- the
 * old behaviour -- refused the field outright, because there was no host
 * element rendering `eyebrow` to annotate.
 *
 * The rule the last test states is the invariant the whole rewrite rests on:
 * an annotated element's only content may be the field's value, because the
 * editor applies an edit with `element.textContent = text`. `Eyebrow`'s span
 * holds the rule as well, so the value gets a span of its own -- conditionally,
 * so a caller this pass did not rewrite renders exactly what it did before.
 */
const RUNTIME = "@/src/content/managed-site";

interface RewrittenFiles {
  readonly page: string;
  readonly featureRow: string;
  readonly eyebrow: string;
  readonly figure: string;
}

function rewritten(): RewrittenFiles {
  const space = workspace("receiverchain", configFor(["/"]));
  applyRewrite(planRewrite(run(space), RUNTIME), RUNTIME);
  const read = (relative: string): string =>
    readFileSync(join(space.repositoryRoot, relative), "utf8");
  return {
    page: read("app/page.tsx"),
    featureRow: read("components/FeatureRow.tsx"),
    eyebrow: read("components/Eyebrow.tsx"),
    figure: read("components/Figure.tsx"),
  };
}

const files = rewritten();

test("the caller sends the value and its annotation", () => {
  assert.match(
    files.page,
    /eyebrowAttributes=\{managedText\("field_[a-z0-9]+"\)\.attributes\}/u,
    `the annotation travels with the value:\n${files.page}`,
  );
});

test("a receiver that forwards the value forwards the annotation", () => {
  assert.match(
    files.featureRow,
    /eyebrowAttributes\?: ManagedSiteFieldAttributesV1;/u,
    `the middle receiver takes the annotation:\n${files.featureRow}`,
  );
  assert.match(
    files.featureRow,
    /<Eyebrow childrenAttributes=\{eyebrowAttributes\}>/u,
    `and hands it on rather than dropping it:\n${files.featureRow}`,
  );
});

test("the annotation lands on an element holding only the value", () => {
  assert.match(
    files.eyebrow,
    /childrenAttributes\?: ManagedSiteFieldAttributesV1;/u,
    `the last receiver takes the annotation:\n${files.eyebrow}`,
  );
  assert.match(
    files.eyebrow,
    /childrenAttributes === undefined \? \(/u,
    `an untouched caller must render what it did before:\n${files.eyebrow}`,
  );
  assert.match(
    files.eyebrow,
    /<span \{\.\.\.childrenAttributes\}>\{children\}<\/span>/u,
    `the value shares its element, so it gets one of its own:\n${files.eyebrow}`,
  );
});

/**
 * The same rule with a NAME instead of `children`. `FeatureRow` hands its
 * `caption` to `<Figure caption={caption} />`, so the annotation travels under
 * the name the next component knows the value by -- forwarding it as
 * `childrenAttributes` would name a prop `Figure` does not read, and the
 * caption would render unannotated and uneditable.
 */
test("a value handed on as a named prop is forwarded under that name", () => {
  assert.match(
    files.featureRow,
    /<Figure src="\/hero\.png" caption=\{caption\} captionAttributes=\{captionAttributes\}/u,
    `the annotation is renamed to the receiving prop:\n${files.featureRow}`,
  );
  assert.match(
    files.figure,
    /captionAttributes\?: ManagedSiteFieldAttributesV1;/u,
    `the last receiver takes it:\n${files.figure}`,
  );
  assert.match(
    files.figure,
    /<figcaption \{\.\.\.captionAttributes\}>\{caption\}<\/figcaption>/u,
    `and spreads it where the value renders:\n${files.figure}`,
  );
});
