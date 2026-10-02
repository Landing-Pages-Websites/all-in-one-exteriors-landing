import assert from "node:assert/strict";
import test from "node:test";

import { extractModule } from "./support/proposals.js";

/**
 * The claim under test: an element whose text arrives in more than one piece
 * does not become one editable field.
 *
 * `textRun` JOINS every text child, so `<p>© {legal} All rights reserved.</p>`
 * produced a single value standing for text at two positions with a computed
 * value between them. Nothing can write that back — the editor applies an edit
 * with `element.textContent = text` (`edit-runtime.ts:249`), which replaces
 * the computed value too — so proposing it put fields in the contract that
 * looked editable and were not. 11 of them on All Points Media.
 *
 * The rows are about WHERE the interruption is, because that is what decides
 * whether the text is one piece: before it, after it, both sides, and an
 * element rather than an expression.
 */
function editableValues(source: string): readonly string[] {
  return extractModule(source)
    .candidates.filter((candidate) => candidate.kind === "plain_text")
    .map((candidate) => (candidate.kind === "plain_text" ? candidate.value : ""))
    .sort();
}

const COMPONENT = (body: string): string =>
  `const legal = "All Points Co.";\nexport function Component() {\n  return ${body};\n}\n`;

/**
 * The declared value `{legal}` is still proposed as its OWN field, which is
 * right: it is a module constant read in one place. What must NOT appear is the
 * JOINED text either side of it.
 */
test("text interrupted by a computed value is not proposed as one field", () => {
  const values = editableValues(COMPONENT('<p>© {legal} All rights reserved.</p>'));
  assert.equal(
    values.some((value) => value.includes("All rights reserved")),
    false,
    `the joined text must not be a field: ${JSON.stringify(values)}`,
  );
  assert.deepEqual(values, ["All Points Co."], "the declared value keeps its own field");
});

test("text interrupted by an element is not proposed", () => {
  assert.deepEqual(
    editableValues(COMPONENT('<p>Before <b>mark</b> after</p>')),
    [],
    "an inline mark makes it rich text, and either way it is not two plain fields",
  );
});

test("text only BEFORE an interruption is one piece and is proposed", () => {
  assert.deepEqual(editableValues(COMPONENT('<p>Only before {legal}</p>')), [
    "All Points Co.",
    "Only before",
  ]);
});

test("text only AFTER an interruption is one piece and is proposed", () => {
  assert.deepEqual(editableValues(COMPONENT('<p>{legal} only after</p>')), [
    "All Points Co.",
    "only after",
  ]);
});

test("uninterrupted text is proposed", () => {
  assert.deepEqual(editableValues(COMPONENT('<p>Plain and whole</p>')), ["Plain and whole"]);
});

/**
 * Whitespace-only pieces do not count as text.
 *
 * A template written across lines has whitespace text nodes between its
 * children, and treating those as pieces would refuse almost everything.
 */
test("whitespace between children does not make the text split", () => {
  assert.deepEqual(
    editableValues(
      `export function Component() {\n  return (\n    <p>\n      Whole sentence\n    </p>\n  );\n}\n`,
    ),
    ["Whole sentence"],
  );
});
