import assert from "node:assert/strict";
import test from "node:test";

import { normaliseJsxText } from "../src/jsx-facts.js";

/**
 * The claim under test: an extracted value is the text the page RENDERS.
 *
 * JSX decodes HTML character references in text children, so a value carrying
 * a raw `&apos;` is not what the visitor sees. This was a hand-written map of
 * nine entities; `&apos;` was missing, so `don&apos;t buy one.` reached the
 * content document verbatim and a page rendering it re-escaped the ampersand
 * and showed `don&apos;t` to the customer. Fourteen values on All Points Media
 * carried one.
 *
 * The rows are entity KINDS, not the instances that were missing. A list of
 * entities is never finished — there are over two thousand named references
 * plus every decimal and hexadecimal one — which is why the implementation
 * asks a decoder rather than holding a table.
 */
const CASES: readonly (readonly [string, string, string])[] = [
  // The nine the old map knew, which must not regress.
  ["a named reference in the old list", "Tom &amp; Jerry", "Tom & Jerry"],
  ["curly quotes", "&ldquo;quoted&rdquo;", "“quoted”"],
  // U+00A0, not a plain space: that is what JSX produces, and the old map
  // replaced it with U+0020 and destroyed every non-breaking space.
  ["a non-breaking space", "a&nbsp;b", "a\u00A0b"],
  ["an em dash", "a&mdash;b", "a—b"],
  ["a copyright sign", "&copy; 2026", "© 2026"],
  // The one that was missing, and its numeric spellings.
  ["an apostrophe entity", "don&apos;t buy one.", "don't buy one."],
  ["a decimal reference", "don&#39;t", "don't"],
  ["a hexadecimal reference", "don&#x27;t", "don't"],
  // Named references nobody would have listed.
  ["an ellipsis", "wait&hellip;", "wait…"],
  ["a multiplication sign", "3&times;4", "3×4"],
  ["an accented letter", "caf&eacute;", "café"],
  // Decoding must be ONE pass. Replacing `&amp;` in sequence and then `&lt;`
  // turned `&amp;lt;` into `<`, which is a different document.
  ["a double-encoded reference", "&amp;lt;script&amp;gt;", "&lt;script&gt;"],
  // A bare ampersand is not a reference and must survive.
  ["a bare ampersand", "fish & chips", "fish & chips"],
  // STRICT decoding: HTML's lenient rules read `&not` without a semicolon as
  // `¬`, and JSX does not. The lenient decoder produced `¬arealthing`.
  ["an ampersand before a word", "&notarealthing", "&notarealthing"],
  ["a legacy reference missing its semicolon", "a&amp b", "a&amp b"],
  // Whitespace collapsing is the other half of the function and still applies.
  ["collapsed whitespace", "one\n   two\tthree", "one two three"],
  ["whitespace around an entity", "a &amp;\n b", "a & b"],
];

for (const [why, raw, expected] of CASES) {
  test(`normaliseJsxText decodes ${why}`, () => {
    assert.equal(normaliseJsxText(raw), expected, why);
  });
}

/**
 * An unknown named reference is left alone rather than mangled.
 *
 * `entities` is lenient about a missing semicolon for legacy references, so
 * this asserts the shape it actually produces rather than a guess: whatever it
 * is, the text must still contain the original letters.
 */
test("an unrecognised named reference is left verbatim", () => {
  assert.equal(normaliseJsxText("&notarealentity;"), "&notarealentity;");
});
