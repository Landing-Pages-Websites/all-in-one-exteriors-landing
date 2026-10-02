import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { applyRewrite, planRewrite } from "../src/rewire.js";
import { configFor, run, workspace } from "./support/proposals.js";

/**
 * The claim under test: a collection rendered by a CLIENT component is editable.
 *
 * A client module cannot call the runtime, and a collection cannot travel as
 * the field record a client component's own values use: every item carries the
 * same field ids, so one record keyed by field id holds only one item. It
 * arrives as its own prop instead, keyed by collection and then by the index
 * the template maps at -- the same index the server path uses.
 *
 * The fallback is the shape that caught this out. A client read keeps the
 * ORIGINAL expression so an untouched caller renders what it did before, and
 * the original is the expression INSIDE the braces: `read` is the whole
 * `{slide.title}`, which the server path replaces wholesale, and `?? {slide.title}`
 * inside an expression is a syntax error. The parse guard refused to write it,
 * which is the first time that guard has caught a defect in a path being added
 * rather than one already shipped.
 */
const RUNTIME = "@/src/content/managed-site";

function converted(): { readonly carousel: string; readonly page: string } {
  const space = workspace("clientcollection", configFor(["/"]));
  applyRewrite(planRewrite(run(space), RUNTIME), RUNTIME);
  const read = (relative: string): string =>
    readFileSync(join(space.repositoryRoot, relative), "utf8");
  return {
    carousel: read("components/Carousel.tsx"),
    page: read("app/page.tsx"),
  };
}

const files = converted();

test("the client component takes its items as a prop", () => {
  assert.match(
    files.carousel,
    /export function Carousel\(\{ managedItems \}: \{ managedItems\?: ManagedItems \}\)/u,
    `the component must take the prop:\n${files.carousel}`,
  );
  assert.match(
    files.carousel,
    /import type \{ ManagedItems \} from "@\/src\/content\/managed-site";/u,
    `and the type it names:\n${files.carousel}`,
  );
  assert.doesNotMatch(
    files.carousel,
    /managedItemsFor|managedItem\(/u,
    `a client module cannot call the runtime:\n${files.carousel}`,
  );
});

test("each item is read by the index the template maps at", () => {
  assert.match(
    files.carousel,
    /\{slides\.map\(\(slide, managedIndex\) =>/u,
    `the callback needs the index the item ids are ordered by:\n${files.carousel}`,
  );
  assert.match(
    files.carousel,
    /managedItems\?\.\["collection_[a-z0-9]+"\]\?\.\[managedIndex\]\?\.\["field_[a-z0-9]+"\]\?\.value \?\? slide\.title/u,
    `the read is keyed by collection, index and field:\n${files.carousel}`,
  );
});

test("the fallback is the expression, not the JSX braces around it", () => {
  // `?? {}` is the legitimate empty-attributes fallback; `?? {anything else}`
  // is a JSX expression where an expression belongs.
  assert.doesNotMatch(
    files.carousel,
    /\?\? \{[^}]/u,
    `braces inside an expression are a syntax error:\n${files.carousel}`,
  );
  for (const original of ["slide.title", "slide.note"]) {
    assert.match(
      files.carousel,
      new RegExp(`\\?\\? ${original.replace(".", "\\.")}`, "u"),
      `an untouched caller must render what it did before:\n${files.carousel}`,
    );
  }
});

test("the server caller resolves the items, once per collection", () => {
  assert.match(
    files.page,
    /<Carousel managedItems=\{managedItemsFor\(\["collection_[a-z0-9]+"\]\)\} \/>/u,
    `the server component resolves them:\n${files.page}`,
  );
  assert.equal(
    files.page.match(/managedItemsFor/gu)?.length,
    2,
    `one import and one call, not one per item field:\n${files.page}`,
  );
});
