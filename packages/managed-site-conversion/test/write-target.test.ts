import assert from "node:assert/strict";
import test from "node:test";
import ts from "typescript";

import { isWriteTarget } from "../src/evaluate.js";

/**
 * The claim under test: `isWriteTarget` agrees with TypeScript about which
 * identifiers are written.
 *
 * It is asked whether a name a reading depends on can change under it, so a
 * missed form is a value the reader trusts and the runtime replaces. Review
 * found `({ Tag } = replacement)` exactly that way: the climb listed
 * `PropertyAssignment` and `SpreadAssignment` and not
 * `ShorthandPropertyAssignment`, so a shorthand destructuring assignment read
 * as no write at all.
 *
 * A hand-written corpus can only contain the forms someone thought of, and
 * that is what failed. So the corpus is checked against TypeScript's OWN
 * answer, `ts.isAssignmentTarget`, rather than against expectations typed here:
 * a form nobody imagined still has an authority to disagree with. The oracle is
 * internal to TypeScript, so it is looked up defensively and its absence fails
 * the test loudly instead of quietly passing.
 */
const oracle = (
  ts as unknown as { readonly isAssignmentTarget?: (node: ts.Node) => boolean }
).isAssignmentTarget;

/** Every shape the assignment and destructuring grammars admit for one name. */
const FORMS: readonly string[] = [
  // Plain assignment and its update forms.
  "Tag = x;",
  "Tag += x;",
  "Tag ??= x;",
  "Tag++;",
  "--Tag;",
  "for (Tag of y) {}",
  "for (Tag in y) {}",
  // Object destructuring assignment. The shorthand is the reviewed defect.
  "({ Tag } = x);",
  "({ Tag = d } = x);",
  "({ a: Tag } = x);",
  "({ ...Tag } = x);",
  "({ a: { Tag } } = x);",
  "({ a: [Tag] } = x);",
  // Array destructuring assignment.
  "[Tag] = x;",
  "[, Tag] = x;",
  "[...Tag] = x;",
  "[[Tag]] = x;",
  "[{ Tag }] = x;",
  // Written through a wrapper the grammar allows.
  "(Tag) = x;",
  "Tag! = x;",
  "({ a: Tag! } = x);",
  // Deep nesting. The parent walk was bounded at eight levels and returned
  // "not written" past it, so a deep destructuring assignment read as safe --
  // a limit that failed OPEN. Nine wrappers is the reviewed case; the others
  // sit either side of it and in the object grammar too.
  "[[[[[[[[Tag]]]]]]]] = x;",
  "[[[[[[[[[Tag]]]]]]]]] = x;",
  "[[[[[[[[[[[[Tag]]]]]]]]]]]] = x;",
  "({ a: { b: { c: { d: { e: { f: { g: { h: { i: Tag } } } } } } } } } = x);",
  // The same depth on the READ side must still be a read.
  "y = [[[[[[[[[Tag]]]]]]]]];",
  "({ a: { b: { c: { d: { e: { f: { g: { h: { Tag: i } } } } } } } } } = x);",
  // Reads that LOOK like writes.
  "({ Tag: a } = x);",
  "({ a: Tag.b } = x);",
  "const { Tag } = x;",
  "let [Tag] = x;",
  "y = Tag;",
  "f(Tag);",
  "y = { Tag };",
  "y = { ...Tag };",
  "y = [Tag];",
  "for (const Tag of y) {}",
  "({ a: Tag } = x) => 0;",
];

function firstTagIn(source: string): ts.Identifier {
  const file = ts.createSourceFile("form.ts", source, ts.ScriptTarget.Latest, true);
  let found: ts.Identifier | null = null;
  const visit = (node: ts.Node): void => {
    if (found !== null) return;
    if (ts.isIdentifier(node) && node.text === "Tag") {
      found = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(file, visit);
  assert.ok(found !== null, `no identifier \`Tag\` in ${source}`);
  return found;
}

test("the write-target oracle is available", () => {
  assert.equal(
    typeof oracle,
    "function",
    "ts.isAssignmentTarget is gone, so this suite is no longer checking the climb against TypeScript",
  );
});

for (const form of FORMS) {
  test(`isWriteTarget agrees with TypeScript on \`${form}\``, () => {
    if (typeof oracle !== "function") return;
    const identifier = firstTagIn(form);
    assert.equal(
      isWriteTarget(identifier),
      oracle(identifier),
      `\`${form}\`: this reader and TypeScript disagree about whether \`Tag\` is written`,
    );
  });
}
