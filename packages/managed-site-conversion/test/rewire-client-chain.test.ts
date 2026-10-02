import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { applyRewrite, planRewrite } from "../src/rewire.js";
import { configFor, run, workspace } from "./support/proposals.js";

/**
 * The claim under test: a value in a client component is threaded in from the
 * SERVER component that renders it, through every client component on the way,
 * and into no other component.
 *
 * A client module cannot read the contract -- the package reaches for
 * `node:crypto` -- so the record is resolved by a server caller and forwarded
 * verbatim, keyed by field id. Two things about "which component" decide
 * whether that works, and both were wrong before this test existed:
 *
 *  - the component holding the value was taken to be the FIRST function in the
 *    file, so `WordWall.tsx`'s sibling `Numeral` got the prop and `WordWall`,
 *    which renders the value, did not; and
 *  - callers were looked up by FILE, so `<Numeral/>` -- a call to a sibling in
 *    the same module -- counted as a caller of `WordWall` and was handed a
 *    `managedFields` it does not declare.
 *
 * Both are type errors at build time, which is the only reason they were not
 * silently dark fields. The fixture reproduces both shapes at once: `Wall.tsx`
 * declares `Badge` above `Wall`, and `Wall` renders a second client component.
 */
interface RewrittenFiles {
  readonly wall: string;
  readonly deep: string;
  readonly page: string;
}

const RUNTIME = "@/src/content/managed-site";

function rewritten(): RewrittenFiles {
  const space = workspace("clientchain", configFor(["/"]));
  const proposal = run(space);
  applyRewrite(planRewrite(proposal, RUNTIME), RUNTIME);
  const read = (relative: string): string =>
    readFileSync(join(space.repositoryRoot, relative), "utf8");
  return {
    wall: read("components/Wall.tsx"),
    deep: read("components/Deep.tsx"),
    page: read("app/page.tsx"),
  };
}

const files = rewritten();

test("the component that renders the value gets the prop, not its file's first", () => {
  assert.match(
    files.wall,
    /export function Wall\(\{ managedFields \}/u,
    `Wall must take the prop:\n${files.wall}`,
  );
  assert.match(
    files.wall,
    /function Badge\(\{ label \}: \{ label: string \}\)/u,
    `Badge is a sibling that renders no field and must be untouched:\n${files.wall}`,
  );
});

test("a sibling call is not a caller, so it is passed nothing", () => {
  assert.doesNotMatch(
    files.wall,
    /<Badge[^>]*managedFields/u,
    `Badge does not declare the prop and must not be given it:\n${files.wall}`,
  );
});

test("a client caller forwards the record it was given", () => {
  assert.match(
    files.wall,
    /<Deep managedFields=\{managedFields\}/u,
    `Wall must forward, not resolve:\n${files.wall}`,
  );
  assert.match(
    files.deep,
    /export function Deep\(\{ managedFields \}/u,
    `Deep must take the prop:\n${files.deep}`,
  );
});

test("only the server component resolves the record", () => {
  assert.match(
    files.page,
    /<Wall managedFields=\{managedFieldsFor\(\[/u,
    `the server page resolves the values:\n${files.page}`,
  );
  assert.doesNotMatch(
    files.wall,
    /managedFieldsFor/u,
    `a client module cannot call the runtime:\n${files.wall}`,
  );
  assert.doesNotMatch(
    files.deep,
    /managedFieldsFor/u,
    `a client module cannot call the runtime:\n${files.deep}`,
  );
});

test("both client components read their own field by id", () => {
  assert.match(files.wall, /managedFields\?\.\["field_[a-z0-9]+"\]\?\.value/u);
  assert.match(files.deep, /managedFields\?\.\["field_[a-z0-9]+"\]\?\.value/u);
});

/**
 * `Deep` renders its value through a module constant -- `<p>{networkScale.line}</p>`
 * -- rather than typing it in place. Only a text RUN was handled, so a value
 * read this way stayed dark for the shape of the read rather than for anything
 * about the value.
 *
 * What differs is the fallback: there is no literal to fall back to, so the
 * expression that is already written is what renders when no caller passes
 * anything. Falling back to the value's TEXT would inline a copy of a constant
 * and the two would drift.
 */
test("an expression child falls back to the expression, not a copy of it", () => {
  assert.match(
    files.deep,
    /\?\.value \?\? networkScale\.line\}/u,
    `the constant stays the fallback:\n${files.deep}`,
  );
  assert.doesNotMatch(
    files.deep,
    /\?\? "Two client components/u,
    `inlining its text would let the two drift:\n${files.deep}`,
  );
});
