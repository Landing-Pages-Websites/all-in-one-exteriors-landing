import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { applyRewrite, planRewrite } from "../src/rewire.js";
import { configFor, run, workspace } from "./support/proposals.js";

/**
 * The claim under test: a value a component renders as its CHILDREN is
 * rewritten on both sides -- the caller supplies the value and the annotation,
 * the component spreads the annotation onto the host element it wraps them in.
 *
 * `<Button>{ctas.secondary.label}</Button>` was refused outright: the reader
 * saw a component tag around the expression and stopped. But `children` is a
 * prop like any other, and the annotation has the same place to go as a named
 * one -- annotating the CALL SITE would mark the caller and the editor would
 * highlight the wrong element.
 *
 * The receiver is edited once however many callers it has, which is what the
 * second test is about: a second destructuring of the same name does not
 * compile, and All Points Media renders `Button` from eleven places.
 */
const RUNTIME = "@/src/content/managed-site";

interface RewrittenFiles {
  readonly page: string;
  readonly button: string;
}

function rewritten(): RewrittenFiles {
  const space = workspace("childrenhop", configFor(["/"]));
  applyRewrite(planRewrite(run(space), RUNTIME), RUNTIME);
  const read = (relative: string): string =>
    readFileSync(join(space.repositoryRoot, relative), "utf8");
  return { page: read("app/page.tsx"), button: read("components/Button.tsx") };
}

const files = rewritten();

test("the caller passes the value and the annotation for it", () => {
  assert.match(
    files.page,
    /<Button href=\{ctas\.\w+\.href\} childrenAttributes=\{managedText\("field_[a-z0-9]+"\)\.attributes\}>/u,
    `the annotation travels with the value:\n${files.page}`,
  );
  assert.match(
    files.page,
    /\{managedText\("field_[a-z0-9]+"\)\.value\}/u,
    `the value comes from the contract:\n${files.page}`,
  );
});

test("the receiver spreads it on the host element it wraps children in", () => {
  assert.match(
    files.button,
    /childrenAttributes\?: ManagedSiteFieldAttributesV1;/u,
    `the prop is optional, so an untouched caller still compiles:\n${files.button}`,
  );
  assert.match(
    files.button,
    /<span \{\.\.\.childrenAttributes\}>\{children\}<\/span>/u,
    `the annotation lands where the value renders:\n${files.button}`,
  );
});

test("a receiver rendered from two places is edited once", () => {
  assert.equal(
    files.button.match(/childrenAttributes\?:/gu)?.length,
    1,
    `a second destructuring of the same name does not compile:\n${files.button}`,
  );
  assert.equal(files.button.match(/, childrenAttributes/gu)?.length, 1);
});
