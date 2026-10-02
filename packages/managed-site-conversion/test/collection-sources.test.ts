import assert from "node:assert/strict";
import test from "node:test";

import { renderAnchor } from "../src/anchors.js";
import type { CollectionCandidate } from "../src/candidates.js";
import { type ComponentExtraction, extractFiles } from "./support/proposals.js";

/**
 * Where a repeated region's ITEMS come from.
 *
 * A collection is read from an array of objects, and the reader accepted only
 * the narrowest possible spelling of that: a bare identifier declared in the
 * same module, whose objects hold nothing but strings. Real sites keep this
 * data in a module of their own and put a `string[]` or an icon beside the
 * copy, so the commonest shape on a real page was refused outright.
 *
 * The rule that replaces it: the TEMPLATE decides which properties are fields,
 * and each of those must resolve to a string in every item. A property the
 * template never renders cannot make the collection unreadable, and a property
 * it does render but that is missing from an item must refuse — never default
 * to empty, which silently publishes a blank where the page shows text.
 */

function extract(files: Readonly<Record<string, string>>): ComponentExtraction {
  return extractFiles(files, "List.tsx");
}

function collectionOf(extracted: ComponentExtraction): CollectionCandidate {
  const found = extracted.candidates.find(
    (candidate): candidate is CollectionCandidate => candidate.kind === "collection",
  );
  assert.ok(found !== undefined, "expected a collection candidate");
  return found;
}

/** Values keyed by property: the template decides the ORDER, which is not the claim here. */
function itemValues(
  collection: CollectionCandidate,
): readonly Readonly<Record<string, string>>[] {
  return collection.items.map((item) =>
    Object.fromEntries(item.map((value) => [value.property, value.value])),
  );
}

const LIST = (source: string, imports = "") =>
  `${imports}\nexport function List() {\n  return (\n    <ul>\n      {${source}.map((item) => (\n        <li key={item.slug}><h3>{item.title}</h3><p>{item.blurb}</p></li>\n      ))}\n    </ul>\n  );\n}\n`;

test("a collection read from an imported module is proposed", () => {
  const extracted = extract({
    "lib/data.ts":
      `export const rows = [\n` +
      `  { slug: "a", title: "First", blurb: "One" },\n` +
      `  { slug: "b", title: "Second", blurb: "Two" },\n];\n`,
    "List.tsx": LIST("rows", `import { rows } from "./lib/data";`),
  });
  const collection = collectionOf(extracted);
  assert.deepEqual(
    collection.itemFields.map((field) => field.property).sort(),
    ["blurb", "title"],
  );
  assert.deepEqual(itemValues(collection), [
    { title: "First", blurb: "One" },
    { title: "Second", blurb: "Two" },
  ]);
});

test("a collection read through a property path is proposed", () => {
  const extracted = extract({
    "lib/data.ts":
      `export const company = {\n  offices: [\n` +
      `    { slug: "a", title: "Portland", blurb: "Oregon" },\n` +
      `    { slug: "b", title: "Philadelphia", blurb: "Pennsylvania" },\n  ],\n};\n`,
    "List.tsx": LIST("company.offices", `import { company } from "./lib/data";`),
  });
  assert.deepEqual(itemValues(collectionOf(extracted)), [
    { title: "Portland", blurb: "Oregon" },
    { title: "Philadelphia", blurb: "Pennsylvania" },
  ]);
});

/**
 * The template decides which properties are fields. A `string[]` or an icon
 * beside the copy is not a text field and was never going to be one; refusing
 * the whole collection over it threw away every value that IS readable.
 */
test("a property the template never renders does not refuse the collection", () => {
  const extracted = extract({
    "lib/data.ts":
      `import { Icon } from "./icon";\n` +
      `export const rows = [\n` +
      `  { slug: "a", title: "First", blurb: "One", useCases: ["x", "y"], icon: Icon },\n` +
      `  { slug: "b", title: "Second", blurb: "Two", useCases: ["z"], icon: Icon },\n];\n`,
    "icon.ts": `export const Icon = () => null;`,
    "List.tsx": LIST("rows", `import { rows } from "./lib/data";`),
  });
  const collection = collectionOf(extracted);
  assert.deepEqual(
    collection.itemFields.map((field) => field.property).sort(),
    ["blurb", "title"],
  );
  assert.deepEqual(itemValues(collection), [
    { title: "First", blurb: "One" },
    { title: "Second", blurb: "Two" },
  ]);
});

/**
 * A rendered property missing from one item must refuse. Defaulting it to ""
 * publishes a blank where the page shows text, which is the silent failure this
 * whole tool exists to avoid.
 */
test("a rendered property missing from one item refuses the collection", () => {
  const extracted = extract({
    "lib/data.ts":
      `export const rows = [\n` +
      `  { slug: "a", title: "First", blurb: "One" },\n` +
      `  { slug: "b", title: "Second" },\n];\n`,
    "List.tsx": LIST("rows", `import { rows } from "./lib/data";`),
  });
  assert.equal(
    extracted.candidates.filter((candidate) => candidate.kind === "collection").length,
    0,
  );
  assert.ok(extracted.findings.some((finding) => finding.code === "NON_LITERAL_VALUE"));
});

test("a rendered property that is not a string refuses the collection", () => {
  const extracted = extract({
    "lib/data.ts":
      `export const rows = [\n` +
      `  { slug: "a", title: "First", blurb: "One" },\n` +
      `  { slug: "b", title: "Second", blurb: 2 },\n];\n`,
    "List.tsx": LIST("rows", `import { rows } from "./lib/data";`),
  });
  assert.equal(
    extracted.candidates.filter((candidate) => candidate.kind === "collection").length,
    0,
  );
});

test("an array the repository mutates is not read", () => {
  const extracted = extract({
    "lib/data.ts":
      `export const rows = [\n  { slug: "a", title: "First", blurb: "One" },\n];\n`,
    "lib/mutate.ts": `import { rows } from "./data";\nrows[0]!.title = "Rendered";`,
    "List.tsx": LIST("rows", `import { rows } from "./lib/data";`),
  });
  assert.equal(
    extracted.candidates.filter((candidate) => candidate.kind === "collection").length,
    0,
  );
});

test("the collection is still anchored on the binding it is read from", () => {
  const extracted = extract({
    "lib/data.ts":
      `export const rows = [\n  { slug: "a", title: "First", blurb: "One" },\n];\n`,
    "List.tsx": LIST("rows", `import { rows } from "./lib/data";`),
  });
  assert.match(renderAnchor(collectionOf(extracted).anchor), /each:rows$/u);
});

/**
 * `map` and `forEach` do not change an array; `sort` and `push` do. The list of
 * which is which is an enumeration of the LANGUAGE, not of this codebase, so
 * anything unnamed is treated as modifying.
 */
test("an array a modifying method is called on is not read", () => {
  const extracted = extract({
    "lib/data.ts":
      `export const rows = [\n  { slug: "a", title: "First", blurb: "One" },\n];\n`,
    "lib/order.ts":
      `import { rows } from "./data";\nrows.sort((a, b) => a.title.localeCompare(b.title));`,
    "List.tsx": LIST("rows", `import { rows } from "./lib/data";`),
  });
  assert.equal(
    extracted.candidates.filter((candidate) => candidate.kind === "collection").length,
    0,
  );
});

/**
 * A callback receives the ELEMENTS, so a read-only method is only read-only if
 * what it is handed does not write through them.
 */
test("an array whose elements a callback writes through is not read", () => {
  const extracted = extract({
    "lib/data.ts":
      `export const rows = [\n  { slug: "a", title: "First", blurb: "One" },\n];\n`,
    "lib/touch.ts":
      `import { rows } from "./data";\nrows.forEach((row) => { row.title = "Rendered"; });`,
    "List.tsx": LIST("rows", `import { rows } from "./lib/data";`),
  });
  assert.equal(
    extracted.candidates.filter((candidate) => candidate.kind === "collection").length,
    0,
  );
});

/** A callback that only reads leaves the array readable. */
test("an array a read-only callback iterates is still read", () => {
  const extracted = extract({
    "lib/data.ts":
      `export const rows = [\n  { slug: "a", title: "First", blurb: "One" },\n];\n`,
    "lib/count.ts":
      `import { rows } from "./data";\nconst titles = rows.map((row) => row.title);\nvoid titles;`,
    "List.tsx": LIST("rows", `import { rows } from "./lib/data";`),
  });
  assert.deepEqual(itemValues(collectionOf(extracted)), [{ title: "First", blurb: "One" }]);
});

/**
 * A callback receives the elements AND the array, so "read-only" has to mean
 * nothing it binds is written through — not that its FIRST parameter is not.
 *
 * `forEach` hands the callback the array as its third argument, and an element
 * can be aliased before it is written to. Either one changes the collection the
 * page renders while the reader still publishes the source literal.
 */
const MUTATING_CALLBACKS: readonly (readonly [string, string])[] = [
  [
    "the array parameter",
    `rows.forEach((row, index, all) => { all.push({ slug: "c", title: "Added", blurb: "New" }); });`,
  ],
  [
    "an alias of an element",
    `rows.forEach((row) => { const copy = row; copy.title = "Rendered"; });`,
  ],
  [
    "an element aliased through a second hop",
    `rows.forEach((row) => { const first = row; const second = first; second.title = "Rendered"; });`,
  ],
];

for (const [description, mutator] of MUTATING_CALLBACKS) {
  test(`an array a callback mutates through ${description} is not read`, () => {
    const extracted = extract({
      "lib/data.ts":
        `export const rows = [\n  { slug: "a", title: "First", blurb: "One" },\n];\n`,
      "lib/touch.ts": `import { rows } from "./data";\n${mutator}\n`,
      "List.tsx": LIST("rows", `import { rows } from "./lib/data";`),
    });
    assert.equal(
      extracted.candidates.filter((candidate) => candidate.kind === "collection").length,
      0,
      description,
    );
  });
}

/**
 * Reading how MANY items there are is not reaching the items.
 *
 * `rows.length` is a number, and nothing done to a number reaches the array --
 * the same reason the index parameter is not tracked. But the read is not text
 * either, so the escape index recorded it as a path handed out, and a
 * collection read (whose own path is the whole object) matched it. One
 * `const count = rows.length` in any module then made the collection
 * unreadable.
 *
 * Writing `length` still refuses; that is the row below this one.
 */
const HARMLESS_METADATA_READS: readonly (readonly [string, string])[] = [
  ["bound to a name", `const count = rows.length;\nvoid count;`],
  ["read inline", `void rows.length;`],
  ["compared", `void (rows.length === 0);`],
  ["read inside a template", `const label = \`\${rows.length} items\`;\nvoid label;`],
];

/**
 * And the reads that are NOT just a count, so the exception above is exactly as
 * wide as it claims. Each of these refuses because a step BEFORE the `length`
 * hands out something real -- which is also why the "whole path" clause in
 * `isCountRead` has no distinguishing test: every longer path already contains
 * a step that escapes on its own.
 */
const METADATA_READS_THAT_STILL_REFUSE: readonly (readonly [string, string])[] = [
  ["length off an indexed element", `void rows[0]!.length;`],
  ["length off a property of an element", `void rows[0]!.title.length;`],
];

for (const [description, reader] of METADATA_READS_THAT_STILL_REFUSE) {
  test(`an array is not read when a ${description} hands out an item`, () => {
    const extracted = extract({
      "lib/data.ts":
        `export const rows = [\n  { slug: "a", title: "First", blurb: "One" },\n];\n`,
      "lib/count.ts": `import { rows } from "./data";\n${reader}\n`,
      "List.tsx": LIST("rows", `import { rows } from "./lib/data";`),
    });
    assert.equal(
      extracted.candidates.filter((candidate) => candidate.kind === "collection").length,
      0,
      description,
    );
  });
}

for (const [description, reader] of HARMLESS_METADATA_READS) {
  test(`an array is still read when its length is ${description}`, () => {
    const extracted = extract({
      "lib/data.ts":
        `export const rows = [\n  { slug: "a", title: "First", blurb: "One" },\n];\n`,
      "lib/count.ts": `import { rows } from "./data";\n${reader}\n`,
      "List.tsx": LIST("rows", `import { rows } from "./lib/data";`),
    });
    assert.deepEqual(
      itemValues(collectionOf(extracted)),
      [{ title: "First", blurb: "One" }],
      description,
    );
  });
}

/**
 * A write BENEATH what is read invalidates it. `rows.length = 0` empties the
 * array, and the escape is recorded at `length` — a descendant of the empty
 * path a collection read uses — so a check that only matched ancestors let the
 * reader publish items the running page has removed.
 */
const DESCENDANT_WRITES: readonly (readonly [string, string])[] = [
  ["its length", `rows.length = 0;`],
  ["a property of the array object", `(rows as unknown as { total: number }).total = 0;`],
];

for (const [description, mutator] of DESCENDANT_WRITES) {
  test(`an array whose ${description} is written is not read`, () => {
    const extracted = extract({
      "lib/data.ts":
        `export const rows = [\n  { slug: "a", title: "First", blurb: "One" },\n];\n`,
      "lib/touch.ts": `import { rows } from "./data";\n${mutator}\n`,
      "List.tsx": LIST("rows", `import { rows } from "./lib/data";`),
    });
    assert.equal(
      extracted.candidates.filter((candidate) => candidate.kind === "collection").length,
      0,
      description,
    );
  });
}

/** A write to a DIFFERENT declaration still leaves this one readable, so the
 * widened check refuses what it should and no more. */
test("an array is still read when a different binding is written", () => {
  const extracted = extract({
    "lib/data.ts":
      `export const rows = [\n  { slug: "a", title: "First", blurb: "One" },\n];\n` +
      `export const other = { total: 0 };\n`,
    "lib/touch.ts": `import { other } from "./data";\nother.total = 1;\n`,
    "List.tsx": LIST("rows", `import { rows } from "./lib/data";`),
  });
  assert.deepEqual(itemValues(collectionOf(extracted)), [{ title: "First", blurb: "One" }]);
});

/**
 * Read-only is a claim about EVERY reference, not the absence of the writes
 * this reader happens to recognise.
 *
 * Three rounds of review each named one more way to change an array from
 * inside a callback — the third parameter, an alias, a mutating method, and
 * now a computed index and a call that takes the element. Enumerating them
 * does not terminate. Each row here is a reference that is not provably a
 * read, and the reading refuses on all of them.
 */
const UNPROVABLE_CALLBACKS: readonly (readonly [string, string])[] = [
  [
    "a computed index assignment",
    `rows.forEach((row, index, all) => { all[index] = { slug: "z", title: "Rendered", blurb: "New" }; });`,
  ],
  [
    "an element handed to an unknown call",
    `rows.forEach((row) => Object.assign(row, { title: "Rendered" }));`,
  ],
  [
    "the array handed to an unknown call",
    `rows.forEach((row, index, all) => { sink(all); });`,
  ],
  [
    "an element read through a computed key",
    `rows.forEach((row) => { const key = pick(); (row as Record<string, string>)[key] = "Rendered"; });`,
  ],
  [
    "an element returned out of the callback",
    `rows.map((row) => row).forEach((escaped) => { escaped.title = "Rendered"; });`,
  ],
];

for (const [description, mutator] of UNPROVABLE_CALLBACKS) {
  test(`an array is not read when a callback uses an element through ${description}`, () => {
    const extracted = extract({
      "lib/data.ts":
        `export const rows = [\n  { slug: "a", title: "First", blurb: "One" },\n];\n`,
      "lib/touch.ts":
        `import { rows } from "./data";\n` +
        `declare function sink(value: unknown): void;\ndeclare function pick(): string;\n` +
        `${mutator}\n`,
      "List.tsx": LIST("rows", `import { rows } from "./lib/data";`),
    });
    assert.equal(
      extracted.candidates.filter((candidate) => candidate.kind === "collection").length,
      0,
      description,
    );
  });
}

/**
 * A non-mutating METHOD is only half the question; the other half is where its
 * result goes. `at`, `find`, `filter` and `slice` hand back the SOURCE
 * elements, so a write through the returned value changes a rendered item
 * without ever naming the array — the call the method list calls harmless is
 * the one that carried the reference out.
 *
 * The first four rows are the shapes the review named. The rest are the ones
 * it did not: the same defect reached through an index, through a binding,
 * through a second link of the chain, and out through an export.
 */
const ESCAPING_RESULTS: readonly (readonly [string, string])[] = [
  ["an element handed back by at", `rows.at(0)!.title = "Rendered";`],
  ["an element handed back by find", `rows.find((row) => row.slug === "a")!.title = "Rendered";`],
  [
    "an index into what filter handed back",
    `rows.filter((row) => row.slug === "a")[0]!.title = "Rendered";`,
  ],
  [
    "a string-literal index into what slice handed back",
    `rows.slice(0, 1)["0"]!.title = "Rendered";`,
  ],
  [
    "a name the result was bound to",
    `const picked = rows.slice(0, 1);\npicked[0]!.title = "Rendered";`,
  ],
  [
    "a name reached two hops along the chain",
    `const picked = rows.filter((row) => row.slug === "a").slice(0, 1);\npicked[0]!.title = "Rendered";`,
  ],
  [
    "an export any importer can write through",
    `export const picked = rows.filter((row) => row.slug === "a");`,
  ],
  [
    "an operand a nullish coalesce hands back",
    `((rows.filter((row) => row.slug === "a") ?? [])[0])!.title = "Rendered";`,
  ],
  [
    "an operand a logical or hands back",
    `((rows.slice(0, 1) || [])[0])!.title = "Rendered";`,
  ],
  ["a result handed to a call", `sink(rows.slice(0, 1));`],
  ["a result returned out of the module", `export function pick() { return rows.slice(0, 1); }`],
  ["a result spread into a new array", `export const all = [...rows.slice(0, 1)];`],
];

for (const [description, mutator] of ESCAPING_RESULTS) {
  test(`an array whose elements reach a write through ${description} is not read`, () => {
    const extracted = extract({
      "lib/data.ts":
        `export const rows = [\n  { slug: "a", title: "First", blurb: "One" },\n];\n`,
      "lib/touch.ts":
        `import { rows } from "./data";\ndeclare function sink(value: unknown): void;\n${mutator}\n`,
      "List.tsx": LIST("rows", `import { rows } from "./lib/data";`),
    });
    assert.equal(
      extracted.candidates.filter((candidate) => candidate.kind === "collection").length,
      0,
      description,
    );
  });
}

/**
 * `this` is the receiver a second argument to `forEach` binds, so a callback
 * that names NOTHING can still reach the array, and a proof that starts from
 * the parameter list cannot see it.
 *
 * These rows assert the OUTCOME, not the mechanism, and the distinction is
 * worth stating: handing the array over as that second argument is itself an
 * escape, so every row here is refused with the `this` checks removed as well.
 * They were kept anyway — they are cheap and they fail closed — but nothing
 * below proves they are load-bearing. Shapes tried and refused either way: a
 * bare identifier `thisArg`, a parenthesized one, one reached through a
 * namespace import, and a callback that binds a parameter and uses `this` too.
 */
const THIS_CALLBACKS: readonly (readonly [string, string])[] = [
  [
    "a parameterless callback with the array as thisArg",
    `rows.forEach(function () { this.push({ slug: "c", title: "Added", blurb: "New" }); }, rows);`,
  ],
  [
    "a parenthesized thisArg",
    `rows.forEach(function () { this.push({ slug: "c", title: "Added", blurb: "New" }); }, (rows));`,
  ],
  [
    "a callback that binds a parameter and still uses this",
    `rows.forEach(function (row) { this.push({ slug: row.slug, title: "Added", blurb: "New" }); }, rows);`,
  ],
];

for (const [description, mutator] of THIS_CALLBACKS) {
  test(`an array a callback reaches through ${description} is not read`, () => {
    const extracted = extract({
      "lib/data.ts":
        `export const rows = [\n  { slug: "a", title: "First", blurb: "One" },\n];\n`,
      "lib/touch.ts": `import { rows } from "./data";\n${mutator}\n`,
      "List.tsx": LIST("rows", `import { rows } from "./lib/data";`),
    });
    assert.equal(
      extracted.candidates.filter((candidate) => candidate.kind === "collection").length,
      0,
      description,
    );
  });
}

/**
 * Absent and empty are different answers.
 *
 * A rendered property MISSING from an item must refuse, because publishing a
 * blank there would silently replace text the page shows. A property that is
 * present and empty is a string the page already renders as nothing, and the
 * editable field should hold exactly that. Conflating them dropped a whole
 * collection over one blank blurb.
 */
test("an item whose rendered text is empty is still read", () => {
  const extracted = extract({
    "lib/data.ts":
      `export const rows = [\n  { slug: "a", title: "First", blurb: "" },\n];\n`,
    "List.tsx": LIST("rows", `import { rows } from "./lib/data";`),
  });
  assert.deepEqual(itemValues(collectionOf(extracted)), [{ title: "First", blurb: "" }]);
});

test("one empty item does not drop the items around it", () => {
  const extracted = extract({
    "lib/data.ts":
      `export const rows = [\n  { slug: "a", title: "First", blurb: "" },\n` +
      `  { slug: "b", title: "Second", blurb: "Two" },\n];\n`,
    "List.tsx": LIST("rows", `import { rows } from "./lib/data";`),
  });
  assert.deepEqual(itemValues(collectionOf(extracted)), [
    { title: "First", blurb: "" },
    { title: "Second", blurb: "Two" },
  ]);
});

test("an item missing the rendered property is still refused", () => {
  const extracted = extract({
    "lib/data.ts":
      `export const rows = [\n  { slug: "a", title: "First" },\n];\n`,
    "List.tsx": LIST("rows", `import { rows } from "./lib/data";`),
  });
  assert.equal(
    extracted.candidates.filter((candidate) => candidate.kind === "collection").length,
    0,
  );
});

/**
 * A value read OUT of the collection is a source element, and where it goes is
 * the same question the call result answers. Indexing hands back an item;
 * naming a property hands back that property, and every property this reader
 * publishes is proven a string literal elsewhere.
 */
const ESCAPING_ELEMENT_READS: readonly (readonly [string, string])[] = [
  [
    "an index read handed to an unknown function",
    `rows.forEach((row, index, all) => sink(all["0"]));`,
  ],
  [
    "an index read returned out of the callback",
    `const kept = rows.map((row, index, all) => all["0"]);\nvoid kept;`,
  ],
  [
    "an index read bound and handed out",
    `rows.forEach((row, index, all) => { const first = all["0"]; sink(first); });`,
  ],
  [
    "the arguments object handed out",
    `rows.forEach(function (row) { sink(arguments[0]); });`,
  ],
  [
    "the arguments object read for an item",
    `rows.forEach(function (row) { sink(arguments); });`,
  ],
];

for (const [description, mutator] of ESCAPING_ELEMENT_READS) {
  test(`an array whose elements leave through ${description} is not read`, () => {
    const extracted = extract({
      "lib/data.ts":
        `export const rows = [\n  { slug: "a", title: "First", blurb: "One" },\n];\n`,
      "lib/touch.ts":
        `import { rows } from "./data";\ndeclare function sink(value: unknown): void;\n${mutator}\n`,
      "List.tsx": LIST("rows", `import { rows } from "./lib/data";`),
    });
    assert.equal(
      extracted.candidates.filter((candidate) => candidate.kind === "collection").length,
      0,
      description,
    );
  });
}

/**
 * A name leaves the module by more ways than the keyword on its statement.
 * Each of these hands the derived collection to importers, who can write
 * through it where this reader cannot see them.
 */
const EXPORTED_DERIVATIONS: readonly (readonly [string, string])[] = [
  ["an export list", `const picked = rows.slice(0, 1);\nexport { picked };`],
  ["a renaming export list", `const picked = rows.slice(0, 1);\nexport { picked as selected };`],
  ["a default export", `const picked = rows.slice(0, 1);\nexport default picked;`],
];

for (const [description, mutator] of EXPORTED_DERIVATIONS) {
  test(`a collection derived and handed out through ${description} is not read`, () => {
    const extracted = extract({
      "lib/data.ts":
        `export const rows = [\n  { slug: "a", title: "First", blurb: "One" },\n];\n`,
      "lib/touch.ts": `import { rows } from "./data";\n${mutator}\n`,
      "List.tsx": LIST("rows", `import { rows } from "./lib/data";`),
    });
    assert.equal(
      extracted.candidates.filter((candidate) => candidate.kind === "collection").length,
      0,
      description,
    );
  });
}

/**
 * Rendering a value is not the same as handing it to a component.
 *
 * A JSX ATTRIBUTE is a prop wherever it sits, and a child of a COMPONENT is its
 * `children` prop. Either hands the value to code this reader has not opened,
 * so `<Mutator rows={rows.filter(f)} />` renders nothing -- it passes the source
 * items to `Mutator`. A dotted tag is a member expression and so a component
 * however its parts are spelled: `<motion.div>` is not a `div`.
 */
const HANDED_TO_A_COMPONENT: readonly (readonly [string, string])[] = [
  [
    "a component prop",
    `<Mutator rows={rows.filter((row) => row.slug === "a")} />`,
  ],
  [
    "a component child",
    `<Mutator>{rows.slice(0, 1)}</Mutator>`,
  ],
  [
    "a dotted tag's prop",
    `<motion.div rows={rows.slice(0, 1)} />`,
  ],
  [
    "a dotted tag's child",
    `<motion.div>{rows.slice(0, 1)}</motion.div>`,
  ],
];

for (const [description, use] of HANDED_TO_A_COMPONENT) {
  test(`an array reaching ${description} is not read`, () => {
    const extracted = extract({
      "lib/data.ts":
        `export const rows = [\n  { slug: "a", title: "First", blurb: "One" },\n];\n`,
      "Hand.tsx":
        `import { rows } from "./lib/data";\n` +
        `declare const Mutator: (props: { rows?: unknown; children?: unknown }) => null;\n` +
        `declare const motion: { div: (props: { rows?: unknown; children?: unknown }) => null };\n` +
        `export function Hand() {\n  return ${use};\n}\n`,
      "List.tsx": LIST("rows", `import { rows } from "./lib/data";`),
    });
    assert.equal(
      extracted.candidates.filter((candidate) => candidate.kind === "collection").length,
      0,
      description,
    );
  });
}

/**
 * And a value that holds nothing of the source may be handed anywhere. A `map`
 * building JSX produces one FRESH element per item, so there is nothing of the
 * item left in the result to write through.
 */
const FRESH_RESULTS: readonly (readonly [string, string])[] = [
  [
    "a map building JSX passed as a prop",
    `<Mutator rows={rows.map((row) => (<li key={row.slug}>{row.title}</li>))} />`,
  ],
  [
    "a map building JSX with a block body",
    `<Mutator rows={rows.map((row) => { return <li key={row.slug}>{row.title}</li>; })} />`,
  ],
  [
    "a map rendered by a host element",
    `<ul>{rows.map((row) => (<li key={row.slug}>{row.title}</li>))}</ul>`,
  ],
];

for (const [description, use] of FRESH_RESULTS) {
  test(`an array is still read through ${description}`, () => {
    const extracted = extract({
      "lib/data.ts":
        `export const rows = [\n  { slug: "a", title: "First", blurb: "One" },\n];\n`,
      "Hand.tsx":
        `import { rows } from "./lib/data";\n` +
        `declare const Mutator: (props: { rows?: unknown }) => null;\n` +
        `export function Hand() {\n  return ${use};\n}\n`,
      "List.tsx": LIST("rows", `import { rows } from "./lib/data";`),
    });
    assert.deepEqual(
      itemValues(collectionOf(extracted)),
      [{ title: "First", blurb: "One" }],
      description,
    );
  });
}

/**
 * A call is proven only when its receiver is a PRIMITIVE, and the receiver is
 * what the chain resolves to in the items -- not the immediate access. Nothing
 * done to a string reaches the object the string came from; `row.meta.touch()`
 * is a call on whatever `meta` holds.
 */
const CHAINED_CALLS: readonly (readonly [string, string, boolean])[] = [
  ["a call on a string property", `const s = rows.map((row) => row.title.toUpperCase());\nvoid s;`, true],
  ["a call two links out on a string", `const s = rows.map((row) => row.title.trim().toUpperCase());\nvoid s;`, true],
  ["a call on a nested list of strings", `const s = rows.map((row) => row.lines.join(", "));\nvoid s;`, true],
  ["a call on an absent property", `const s = rows.map((row) => row.meta.touch());\nvoid s;`, false],
  ["a call on a nested object", `const s = rows.map((row) => row.author.touch());\nvoid s;`, false],
  ["a mutating method on a nested list", `const s = rows.map((row) => row.lines.push("x"));\nvoid s;`, false],
];

for (const [description, use, reads] of CHAINED_CALLS) {
  test(`an array ${reads ? "is still read" : "is not read"} through ${description}`, () => {
    const extracted = extract({
      "lib/data.ts":
        `export const rows = [\n  {\n    slug: "a",\n    title: "First",\n    blurb: "One",\n` +
        `    lines: ["one", "two"],\n    author: { name: "Someone" },\n  },\n];\n`,
      "lib/touch.ts": `import { rows } from "./data";\n${use}\n`,
      "List.tsx": LIST("rows", `import { rows } from "./lib/data";`),
    });
    const found = extracted.candidates.filter((candidate) => candidate.kind === "collection").length;
    assert.equal(found, reads ? 1 : 0, description);
  });
}

/** A conversion member holding a function runs exactly as a declared one does. */
const CONVERSION_VALUES: readonly (readonly [string, string])[] = [
  ["toString holding a function expression", `    toString: function () { this.title = "Rendered"; return "x"; },\n`],
  ["toString holding an arrow", `    toString: () => "x",\n`],
  ["valueOf holding a function expression", `    valueOf: function () { this.title = "Rendered"; return 1; },\n`],
  ["toString holding an imported name", `    toString: helper,\n`],
];

for (const [description, member] of CONVERSION_VALUES) {
  test(`an array whose items have ${description} is not read`, () => {
    const extracted = extract({
      "lib/data.ts":
        `declare const helper: () => string;\n` +
        `export const rows = [\n  {\n    slug: "a",\n    title: "First",\n    blurb: "One",\n` +
        `${member}  },\n];\n`,
      "lib/touch.ts": `import { rows } from "./data";\nrows.join(",");\n`,
      "List.tsx": LIST("rows", `import { rows } from "./lib/data";`),
    });
    assert.equal(
      extracted.candidates.filter((candidate) => candidate.kind === "collection").length,
      0,
      description,
    );
  });
}

/**
 * An item member that RUNS is not a data property, and reading one is not a
 * read. A getter runs on a property read; `__proto__` inherits whatever a
 * prototype holds, so a conversion or a getter can arrive from a place this
 * reader never looked. Both are the same question as `join` -- does touching an
 * item execute code the module wrote -- so they are proven together.
 */
const RUNNING_ITEM_MEMBERS: readonly (readonly [string, string, string])[] = [
  [
    "a getter read from a callback",
    `    get meta() { this.title = "Rendered"; return "x"; },\n`,
    `const seen = rows.map((row) => row.meta);\nvoid seen;`,
  ],
  [
    "a getter, with the callback reading another property",
    `    get meta() { this.title = "Rendered"; return "x"; },\n`,
    `const seen = rows.map((row) => row.blurb);\nvoid seen;`,
  ],
  [
    "a setter",
    `    set meta(value: string) { this.title = value; },\n`,
    `const seen = rows.map((row) => row.blurb);\nvoid seen;`,
  ],
  [
    "a method, which can be called on the item",
    `    touch() { this.title = "Rendered"; },\n`,
    `const seen = rows.map((row) => row.blurb);\nvoid seen;`,
  ],
  [
    "a method sharing an Array built-in name",
    `    map() { this.title = "Rendered"; },\n`,
    `const seen = rows.map((row) => row.blurb);\nvoid seen;`,
  ],
  [
    "a prototype supplying toString to a join",
    `    __proto__: proto,\n`,
    `rows.join(",");`,
  ],
  [
    "a prototype supplying a getter to a callback",
    `    __proto__: proto,\n`,
    `const seen = rows.map((row) => row.blurb);\nvoid seen;`,
  ],
];

for (const [description, member, use] of RUNNING_ITEM_MEMBERS) {
  test(`an array whose items carry ${description} is not read`, () => {
    const extracted = extract({
      "lib/data.ts":
        `declare const proto: { toString: () => string };\n` +
        `export const rows = [\n  {\n    slug: "a",\n    title: "First",\n    blurb: "One",\n` +
        `${member}  },\n];\n`,
      "lib/touch.ts": `import { rows } from "./data";\n${use}\n`,
      "List.tsx": LIST("rows", `import { rows } from "./lib/data";`),
    });
    assert.equal(
      extracted.candidates.filter((candidate) => candidate.kind === "collection").length,
      0,
      description,
    );
  });
}

/**
 * `join` converts every item, and conversion runs the item's own code. It is
 * allowed only where the items are READ and proven to declare none — which is
 * the difference between refusing a real page's `.join(", ")` and publishing
 * text a `toString()` has already rewritten.
 */
test("an array whose items define toString is not read through join", () => {
  const extracted = extract({
    "lib/data.ts":
      `export const rows = [\n  {\n    slug: "a",\n    title: "First",\n    blurb: "One",\n` +
      `    toString() { this.title = "Rendered"; return this.slug; },\n  },\n];\n`,
    "lib/touch.ts": `import { rows } from "./data";\nrows.join(",");\n`,
    "List.tsx": LIST("rows", `import { rows } from "./lib/data";`),
  });
  assert.equal(
    extracted.candidates.filter((candidate) => candidate.kind === "collection").length,
    0,
  );
});

test("an array whose items define valueOf is not read through join", () => {
  const extracted = extract({
    "lib/data.ts":
      `export const rows = [\n  {\n    slug: "a",\n    title: "First",\n    blurb: "One",\n` +
      `    valueOf() { this.title = "Rendered"; return 1; },\n  },\n];\n`,
    "lib/touch.ts": `import { rows } from "./data";\nrows.join(",");\n`,
    "List.tsx": LIST("rows", `import { rows } from "./lib/data";`),
  });
  assert.equal(
    extracted.candidates.filter((candidate) => candidate.kind === "collection").length,
    0,
  );
});

/**
 * An outcome row, not a proof of the spread guard: the collection reader
 * refuses an item carrying a spread whether `join` is called or not, and the
 * same is true of a computed key. `itemsConvertWithoutUserCode` rejects both
 * anyway — an item whose members cannot be read is exactly the unknown case —
 * but nothing here distinguishes that guard from the reader's own refusal.
 */
test("an array whose items spread something unread is not read through join", () => {
  const extracted = extract({
    "lib/data.ts":
      `declare const extra: { toString: () => string };\n` +
      `export const rows = [\n  { slug: "a", title: "First", blurb: "One", ...extra },\n];\n`,
    "lib/touch.ts": `import { rows } from "./data";\nrows.join(",");\n`,
    "List.tsx": LIST("rows", `import { rows } from "./lib/data";`),
  });
  assert.equal(
    extracted.candidates.filter((candidate) => candidate.kind === "collection").length,
    0,
  );
});

/** And plain items, which convert without running anything the module wrote. */
test("an array of plain items is still read through join", () => {
  const extracted = extract({
    "lib/data.ts":
      `export const rows = [\n  { slug: "a", title: "First", blurb: "One" },\n];\n`,
    "lib/count.ts": `import { rows } from "./data";\nconst all = rows.join(",");\nvoid all;\n`,
    "List.tsx": LIST("rows", `import { rows } from "./lib/data";`),
  });
  assert.deepEqual(itemValues(collectionOf(extracted)), [{ title: "First", blurb: "One" }]);
});

/**
 * A callback this reader cannot OPEN is a callback it cannot clear.
 *
 * The proof only ever applied to functions written inline, and everything else
 * was waved through by asking whether it was an identifier or a call — which
 * `helpers.mutate` is neither. It still receives every source element. So the
 * question is inverted: a literal is the only thing provably not a function,
 * and anything else refuses.
 */
const OPAQUE_CALLBACKS: readonly (readonly [string, string])[] = [
  ["a property of an imported object", `rows.forEach(helpers.mutate);`],
  ["a deeper property chain", `rows.forEach(helpers.deep.mutate);`],
  ["a name bound to a function", `rows.forEach(mutate);`],
  ["a call that returns one", `rows.forEach(pick());`],
  ["a conditional between two", `rows.forEach(flag ? helpers.mutate : helpers.deep.mutate);`],
  ["one reached through a non-null assertion", `rows.forEach(helpers.mutate!);`],
];

for (const [description, mutator] of OPAQUE_CALLBACKS) {
  test(`an array handed a callback that is ${description} is not read`, () => {
    const extracted = extract({
      "lib/data.ts":
        `export const rows = [\n  { slug: "a", title: "First", blurb: "One" },\n];\n`,
      "lib/touch.ts":
        `import { rows } from "./data";\n` +
        `declare const helpers: { mutate: (row: { title: string }) => void; deep: { mutate: (row: { title: string }) => void } };\n` +
        `declare const flag: boolean;\n` +
        `declare function mutate(row: { title: string }): void;\n` +
        `declare function pick(): (row: { title: string }) => void;\n` +
        `${mutator}\n`,
      "List.tsx": LIST("rows", `import { rows } from "./lib/data";`),
    });
    assert.equal(
      extracted.candidates.filter((candidate) => candidate.kind === "collection").length,
      0,
      description,
    );
  });
}

/**
 * Which parameter is the NUMBER is a fact about the method, not a constant.
 *
 * `forEach` passes `(element, index, array)`, so skipping position 1 is what
 * lets `(item, i) => … key={i} …` read. `reduce` passes `(accumulator,
 * currentValue, currentIndex, array)`, where position 1 is a SOURCE ITEM —
 * so the same skip handed a callback a free reference to write through.
 */
const REDUCE_CALLBACKS: readonly (readonly [string, string])[] = [
  [
    "assigned onto through Object.assign",
    `const seen = rows.reduce((acc, row) => Object.assign(row, { title: "Rendered" }), null);\nvoid seen;`,
  ],
  [
    "written to directly",
    `const seen = rows.reduce((acc, row) => { row.title = "Rendered"; return acc; }, null);\nvoid seen;`,
  ],
  [
    "written to from the right",
    `const seen = rows.reduceRight((acc, row) => { row.title = "Rendered"; return acc; }, null);\nvoid seen;`,
  ],
  [
    "aliased and then written to",
    `const seen = rows.reduce((acc, row) => { const copy = row; copy.title = "Rendered"; return acc; }, null);\nvoid seen;`,
  ],
];

for (const [description, mutator] of REDUCE_CALLBACKS) {
  test(`an array whose reduce parameter is ${description} is not read`, () => {
    const extracted = extract({
      "lib/data.ts":
        `export const rows = [\n  { slug: "a", title: "First", blurb: "One" },\n];\n`,
      "lib/touch.ts": `import { rows } from "./data";\n${mutator}\n`,
      "List.tsx": LIST("rows", `import { rows } from "./lib/data";`),
    });
    assert.equal(
      extracted.candidates.filter((candidate) => candidate.kind === "collection").length,
      0,
      description,
    );
  });
}

/**
 * A reduce that only reads is refused too, and that is the intended answer
 * rather than a gap: `reduce` is not in the modelled map at all, so its
 * callback fails closed. These rows exist to pin that down — an unmodelled
 * method refuses whatever its callback does — and to prove the refusals above
 * are not the map quietly succeeding for another reason.
 */
const UNMODELLED_METHOD_CALLBACKS: readonly (readonly [string, string])[] = [
  [
    "a reduce that only reads a property",
    `const joined = rows.reduce((acc, row) => acc + row.title, "");\nvoid joined;`,
  ],
  [
    "a reduce that only reads, with an index",
    `const joined = rows.reduce((acc, row, i) => acc + row.title + i, "");\nvoid joined;`,
  ],
];

for (const [description, reader] of UNMODELLED_METHOD_CALLBACKS) {
  test(`an array is not read through ${description}`, () => {
    const extracted = extract({
      "lib/data.ts":
        `export const rows = [\n  { slug: "a", title: "First", blurb: "One" },\n];\n`,
      "lib/count.ts": `import { rows } from "./data";\n${reader}\n`,
      "List.tsx": LIST("rows", `import { rows } from "./lib/data";`),
    });
    assert.equal(
      extracted.candidates.filter((candidate) => candidate.kind === "collection").length,
      0,
      description,
    );
  });
}

/**
 * An element is whatever the source array holds, so a method called ON one
 * proves nothing: the Array built-ins are a fact about arrays, and an object
 * literal is free to define its own `map` that rewrites what the page renders.
 */
const ELEMENT_METHOD_CALLBACKS: readonly (readonly [string, string])[] = [
  [
    "a method sharing a built-in Array name",
    `rows.forEach((row) => { row.map(); });`,
  ],
  [
    "a method with any other name",
    `rows.forEach((row) => { row.touch(); });`,
  ],
  [
    "a write reached past a string-literal key",
    `rows.forEach((row, index, all) => { all["0"].title = "Rendered"; });`,
  ],
  [
    "a write reached past a computed key",
    `rows.forEach((row, index, all) => { all[index].title = "Rendered"; });`,
  ],
];

for (const [description, mutator] of ELEMENT_METHOD_CALLBACKS) {
  test(`an array a callback reaches through ${description} is not read`, () => {
    const extracted = extract({
      // Plain items, deliberately: these rows are about the CALL, and items
      // that declared a method would be refused by the plain-data proof before
      // the call rule was ever asked. `map` is the point of the first row --
      // sharing a name with an Array built-in says nothing about what is being
      // called on an element.
      "lib/data.ts":
        `export const rows = [\n  { slug: "a", title: "First", blurb: "One" },\n];\n`,
      "lib/touch.ts": `import { rows } from "./data";\n${mutator}\n`,
      "List.tsx": LIST("rows", `import { rows } from "./lib/data";`),
    });
    assert.equal(
      extracted.candidates.filter((candidate) => candidate.kind === "collection").length,
      0,
      description,
    );
  });
}

/**
 * And the results a chain IS allowed to produce, so the refusals above fail
 * for their own reason rather than because every call now refuses. The middle
 * two are what a real page writes: a subset selected before rendering, and a
 * chain of them. Costed on All Points Media, where refusing the bound name
 * alone took it from 17 collections to 11.
 */
const CONFINED_RESULTS: readonly (readonly [string, string])[] = [
  ["a result read for its length", `void rows.slice(0, 1).length;`],
  [
    "a result bound to a local name and only read",
    `const picked = rows.slice(0, 1);\nvoid picked[0]!.title;`,
  ],
  [
    "a chain of non-mutating calls",
    `const picked = rows.filter((row) => row.slug === "a").slice(0, 1);\nvoid picked.length;`,
  ],
  ["a result compared", `void (rows.filter((row) => row.slug === "a").length === 0);`],
  ["a result negated", `void !rows.some((row) => row.slug === "a");`],
];

for (const [description, reader] of CONFINED_RESULTS) {
  test(`an array is still read when a chain produces ${description}`, () => {
    const extracted = extract({
      "lib/data.ts":
        `export const rows = [\n  { slug: "a", title: "First", blurb: "One" },\n];\n`,
      "lib/count.ts": `import { rows } from "./data";\n${reader}\n`,
      "List.tsx": LIST("rows", `import { rows } from "./lib/data";`),
    });
    assert.deepEqual(
      itemValues(collectionOf(extracted)),
      [{ title: "First", blurb: "One" }],
      description,
    );
  });
}

/**
 * And the reading a callback IS allowed to make, so the refusals above fail
 * for their own reason rather than because every callback now refuses.
 */
const PROVABLE_CALLBACKS: readonly (readonly [string, string])[] = [
  ["a named property read", `const titles = rows.map((row) => row.title);\nvoid titles;`],
  ["a nested named read", `const slugs = rows.map((row) => row.slug.length);\nvoid slugs;`],
  ["a string-literal key", `const first = rows.map((row) => row["title"]);\nvoid first;`],
  ["a read-only method on the array", `const found = rows.filter((row) => row.slug === "a");\nvoid found;`],
];

for (const [description, reader] of PROVABLE_CALLBACKS) {
  test(`an array is still read when a callback uses ${description}`, () => {
    const extracted = extract({
      "lib/data.ts":
        `export const rows = [\n  { slug: "a", title: "First", blurb: "One" },\n];\n`,
      "lib/count.ts": `import { rows } from "./data";\n${reader}\n`,
      "List.tsx": LIST("rows", `import { rows } from "./lib/data";`),
    });
    assert.deepEqual(itemValues(collectionOf(extracted)), [{ title: "First", blurb: "One" }], description);
  });
}

/**
 * The index is a NUMBER. Nothing done to it reaches the array, and tracking it
 * refused every `(item, i) => … key={i} …` callback — which is most of them on
 * a real site — for no safety at all. Costed on All Points Media: tracking the
 * index took it from 18 collections to 11.
 */
const INDEX_CALLBACKS: readonly (readonly [string, string])[] = [
  ["a bare index", `const keys = rows.map((row, i) => \`\${row.slug}-\${i}\`);\nvoid keys;`],
  ["an index used in arithmetic", `const delays = rows.map((row, i) => i * 0.04 + row.slug.length);\nvoid delays;`],
];

for (const [description, reader] of INDEX_CALLBACKS) {
  test(`an array is still read when a callback uses ${description}`, () => {
    const extracted = extract({
      "lib/data.ts":
        `export const rows = [\n  { slug: "a", title: "First", blurb: "One" },\n];\n`,
      "lib/count.ts": `import { rows } from "./data";\n${reader}\n`,
      "List.tsx": LIST("rows", `import { rows } from "./lib/data";`),
    });
    assert.deepEqual(itemValues(collectionOf(extracted)), [{ title: "First", blurb: "One" }], description);
  });
}
