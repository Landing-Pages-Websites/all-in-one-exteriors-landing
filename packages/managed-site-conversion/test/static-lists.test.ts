import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { renderAnchor } from "../src/anchors.js";
import type { Candidate } from "../src/candidates.js";
import { applyConfidenceGate } from "../src/gate.js";
import { extractComponent, findComponentDeclarations, resolveTagRoles } from "../src/extract.js";
import { validateManagedFieldValue } from "@landing-pages-websites/managed-site-contract";

import { propose } from "../src/propose.js";
import { ModuleCache } from "../src/scan.js";

/**
 * A list of static items is ONE value, not several nameless ones.
 *
 * Four `<li>` written out in a section have nothing to tell them apart: no id,
 * no name, only their order — which `anchors.ts` refuses as identity. So each
 * was reported and the whole list went unproposed, even though the section
 * around it was perfectly well named.
 *
 * The list itself has a durable anchor, and the contract's rich text already
 * models `bullet_list` and `ordered_list`. So the list is one rich-text field:
 * the customer edits the list, and no item ever needs an identity of its own.
 */

function extract(source: string): { accepted: readonly Candidate[] } {
  const root = mkdtempSync(join(tmpdir(), "managed-site-lists-"));
  const file = join(root, "Page.tsx");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, source, "utf8");
  const cache = new ModuleCache();
  const parsed = cache.read(file);
  const roles = resolveTagRoles(parsed);
  const candidates = findComponentDeclarations(parsed).flatMap(
    (declaration) => extractComponent(declaration, roles, root, cache).candidates,
  );
  return { accepted: applyConfidenceGate(candidates).accepted };
}

/** Candidates BEFORE the confidence gate, so a row cannot pass because the
 * gate dropped a candidate this reading should never have produced. */
function rawCandidates(source: string): readonly Candidate[] {
  const root = mkdtempSync(join(tmpdir(), "managed-site-lists-raw-"));
  const file = join(root, "Page.tsx");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, source, "utf8");
  const cache = new ModuleCache();
  const parsed = cache.read(file);
  const roles = resolveTagRoles(parsed);
  return findComponentDeclarations(parsed).flatMap(
    (declaration) => extractComponent(declaration, roles, root, cache).candidates,
  );
}

/** Every candidate whose document holds a list block. */
function listsIn(candidates: readonly Candidate[]): readonly Candidate[] {
  return candidates.filter(
    (candidate) =>
      candidate.kind === "rich_text" &&
      candidate.document.content.some(
        (block) => block.type === "bullet_list" || block.type === "ordered_list",
      ),
  );
}

function page(body: string): string {
  return `export function Page() {\n  return (\n    <section id="terms">\n${body}\n    </section>\n  );\n}\n`;
}

function richTextOf(accepted: readonly Candidate[]): Candidate & { kind: "rich_text" } {
  const found = accepted.find(
    (candidate): candidate is Candidate & { kind: "rich_text" } =>
      candidate.kind === "rich_text",
  );
  assert.ok(found !== undefined, "expected a rich-text candidate");
  return found;
}

test("a list of static items is one rich-text value", () => {
  const { accepted } = extract(page(`      <ul><li>One</li><li>Two</li><li>Three</li></ul>`));
  const rich = richTextOf(accepted);
  assert.equal(renderAnchor(rich.anchor), "component:Page/region:terms/role:ul");
  assert.deepEqual(rich.document, {
    type: "doc",
    content: [
      {
        type: "bullet_list",
        content: [
          { type: "list_item", content: [{ type: "paragraph", content: [{ type: "text", text: "One" }] }] },
          { type: "list_item", content: [{ type: "paragraph", content: [{ type: "text", text: "Two" }] }] },
          { type: "list_item", content: [{ type: "paragraph", content: [{ type: "text", text: "Three" }] }] },
        ],
      },
    ],
  });
  assert.equal(accepted.filter((candidate) => candidate.kind === "plain_text").length, 0);
});

test("an ordered list is an ordered list", () => {
  const { accepted } = extract(page(`      <ol><li>First</li><li>Second</li></ol>`));
  const rich = richTextOf(accepted);
  assert.equal(rich.document.content[0]?.type, "ordered_list");
});

test("a list whose item holds a line break keeps the ordinary walk, not a list document", () => {
  // A list document is never rendered in place, so its <br> would lose the
  // source's class. Before breaks were nodes such a list fell back; it still does.
  for (const item of [`One<br />Two`, `One<br className="hidden md:block" />Two`]) {
    const { accepted } = extract(page(`      <ul><li>${item}</li><li>Three</li></ul>`));
    assert.equal(
      accepted.some((candidate) => candidate.kind === "rich_text" && JSON.stringify(candidate).includes("bullet_list")),
      false,
      item,
    );
  }
});

test("marks inside an item survive", () => {
  const { accepted } = extract(
    page(`      <ul><li>Plain <strong>bold</strong></li><li>Two</li></ul>`),
  );
  const rich = richTextOf(accepted);
  const list = rich.document.content[0];
  assert.ok(list !== undefined && list.type === "bullet_list");
  const paragraph = list.content[0]?.content[0];
  assert.ok(paragraph !== undefined);
  // "Plain " and "bold" arrive as two inlines, the second carrying the mark.
  assert.equal(paragraph.content.length, 2);
  assert.deepEqual(paragraph.content[1], { type: "text", text: "bold", marks: [{ type: "bold" }] });
});

test("a list built by map stays a collection, not one blob of text", () => {
  const { accepted } = extract(
    `const rows = [{ title: "A" }, { title: "B" }];\n` +
      `export function Page() {\n` +
      `  return (\n    <section id="terms">\n` +
      `      <ul>{rows.map((row) => <li key={row.title}>{row.title}</li>)}</ul>\n` +
      `    </section>\n  );\n}\n`,
  );
  assert.ok(
    accepted.some((candidate) => candidate.kind === "collection"),
    "expected the mapped list to stay a collection",
  );
  assert.equal(accepted.filter((candidate) => candidate.kind === "rich_text").length, 0);
});

test("a list holding a computed item is not read", () => {
  const { accepted } = extract(
    `export function Page({ extra }: { extra: string }) {\n` +
      `  return (\n    <section id="terms">\n` +
      `      <ul><li>One</li><li>{extra}</li></ul>\n` +
      `    </section>\n  );\n}\n`,
  );
  assert.equal(accepted.filter((candidate) => candidate.kind === "rich_text").length, 0);
});

test("a list holding a nested list is not flattened into one", () => {
  const { accepted } = extract(
    page(`      <ul><li>One</li><li>Two<ul><li>Nested</li></ul></li></ul>`),
  );
  assert.equal(accepted.filter((candidate) => candidate.kind === "rich_text").length, 0);
});

test("a list whose items are links is not reduced to text", () => {
  const { accepted } = extract(
    page(`      <ul><li><a href="/a">One</a></li><li><a href="/b">Two</a></li></ul>`),
  );
  assert.equal(accepted.filter((candidate) => candidate.kind === "rich_text").length, 0);
});

/**
 * The container tag decides, not the children.
 *
 * `buildRichTextListDocument` only checks that every child is an `<li>`; it
 * never looks at what wraps them. Without the `ul`/`ol` gate a `<div>` holding
 * list items would be republished as a `bullet_list`, changing the structure of
 * a page whose author wrote something else — and the gate had no row proving
 * it does anything.
 */
for (const container of ["div", "nav", "menu", "section"] as const) {
  test(`a <${container}> holding <li> children is not read as a list`, () => {
    const { accepted } = extract(
      page(`      <${container}><li>One</li><li>Two</li></${container}>`),
    );
    const asList = accepted.find(
      (candidate) =>
        candidate.kind === "rich_text" &&
        candidate.document.content.some(
          (block) => block.type === "bullet_list" || block.type === "ordered_list",
        ),
    );
    assert.equal(asList, undefined, `<${container}> was read as a list`);
  });
}

/**
 * The three defects above this row share one cause, and this row is the shape
 * that catches all of them: a document is only extracted if the contract
 * emitted beside it ACCEPTS it.
 *
 * Every fixture in this file wrote its list on one line, so no row exercised
 * the indentation between `<li>` siblings — and a conventionally formatted
 * list refused and fell back, which is the only kind of list a real page has.
 * The two rows a proposal alone cannot catch (a contract capping blocks at
 * `paragraph`, and marks collected only from top-level paragraphs) produce a
 * document its own field rejects, which no candidate-level assertion can see.
 */
const CONVENTIONAL_LISTS: readonly (readonly [string, string])[] = [
  [
    "an unordered list over several lines",
    `      <ul>\n        <li>One</li>\n        <li>Two</li>\n        <li>Three</li>\n      </ul>`,
  ],
  [
    "an ordered list over several lines",
    `      <ol>\n        <li>First</li>\n        <li>Second</li>\n      </ol>`,
  ],
  [
    "a list whose items carry formatting",
    `      <ul>\n        <li><strong>Bold</strong> lead</li>\n        <li><em>Italic</em> lead</li>\n      </ul>`,
  ],
  [
    "a list indented with tabs",
    `      <ul>\n\t\t<li>One</li>\n\t\t<li>Two</li>\n      </ul>`,
  ],
];

for (const [description, body] of CONVENTIONAL_LISTS) {
  test(`${description} is one field, and its own contract accepts it`, () => {
    const { accepted } = extract(page(body));
    const rich = richTextOf(accepted);
    const [block] = rich.document.content;
    assert.ok(
      block !== undefined && (block.type === "bullet_list" || block.type === "ordered_list"),
      `expected a list block, got ${JSON.stringify(rich.document.content)}`,
    );
    assert.equal(
      accepted.filter((candidate) => candidate.kind === "plain_text").length,
      0,
      "the items must not also be proposed one by one",
    );
  });
}

/**
 * The statement the three defects above needed: the field the emitter writes
 * ACCEPTS the document the extractor built. A candidate-level assertion cannot
 * see a contract that caps blocks at `paragraph` or omits a mark, because both
 * live in the field beside the value rather than in the value.
 */
for (const [description, body] of CONVENTIONAL_LISTS) {
  test(`the contract emitted for ${description} accepts its own document`, () => {
    const root = mkdtempSync(join(tmpdir(), "managed-site-lists-e2e-"));
    const file = join(root, "app/page.tsx");
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(
      file,
      `export default function Home() {\n  return (\n    <section id="terms">\n${body}\n    </section>\n  );\n}\n`,
      "utf8",
    );
    const proposal = propose({
      repositoryRoot: root,
      configPath: null,
      ledgerPath: join(root, "idmap.json"),
    });
    const draft = proposal.contractDraft as {
      readonly pages: readonly {
        readonly sections: readonly {
          readonly fields: readonly { readonly id: string; readonly type: string }[];
        }[];
      }[];
    };
    const field = draft.pages
      .flatMap((each) => each.sections)
      .flatMap((each) => each.fields)
      .find((each) => each.type === "rich_text");
    assert.ok(field !== undefined, `no rich-text field in ${JSON.stringify(draft.pages)}`);
    const value = proposal.contentDraft.values.find((each) => each.fieldId === field.id);
    assert.ok(value !== undefined, `no value for ${field.id}`);
    // The platform's own validator, not a restatement of it here.
    validateManagedFieldValue(field, value);
  });
}

/**
 * Reading the list as ONE value skips the per-item walk, so it may only be done
 * for items that walk would have treated the same way. Each row below loses
 * something if the list is taken: hidden content becomes editable copy, or an
 * item's own code-owned field disappears from the interface.
 *
 * The permitted attributes are exactly the ones `#collectAttributes` discards,
 * so the two cannot drift: `key` and the structural ones.
 */
const ITEMS_THAT_FALL_BACK: readonly (readonly [string, string])[] = [
  ["an aria-hidden item", `<li aria-hidden="true">Decorative</li><li>Visible</li>`],
  ["an item with aria-label", `<li aria-label="First item">One</li><li>Two</li>`],
  ["an item with aria-describedby", `<li aria-describedby="d">One</li><li>Two</li>`],
  ["an item with an unrecognised attribute", `<li data-role="x">One</li><li>Two</li>`],
];

for (const [why, items] of ITEMS_THAT_FALL_BACK) {
  test(`${why} falls back to the ordinary walk`, () => {
    const { accepted } = extract(page(`      <ul>\n        ${items}\n      </ul>`));
    const asList = accepted.find(
      (candidate) =>
        candidate.kind === "rich_text" &&
        candidate.document.content.some(
          (block) => block.type === "bullet_list" || block.type === "ordered_list",
        ),
    );
    assert.equal(asList, undefined, `${why} was read as one list`);
  });
}

/** The attributes the walk discards do NOT force a fallback, so the rows above
 * refuse for what the attribute means and not for having one at all. */
for (const [why, items] of [
  ["className", `<li className="a">One</li><li className="b">Two</li>`],
  ["key", `<li key="a">One</li><li key="b">Two</li>`],
] as const) {
  test(`items carrying only ${why} are still one list`, () => {
    const { accepted } = extract(page(`      <ul>\n        ${items}\n      </ul>`));
    const rich = richTextOf(accepted);
    const [block] = rich.document.content;
    assert.ok(block !== undefined && block.type === "bullet_list", JSON.stringify(rich.document));
  });
}

/**
 * A mark kind may appear once on a text node; the schema rejects a repeat.
 * Nesting a tag inside itself cannot be said by one mark, and rendering one
 * element where the source had two changes the page, so the list is refused
 * rather than flattened (see `inline-blocks.test.ts`). Two DIFFERENT marks
 * nested are two marks, and the document the list produces must be one its own
 * contract accepts.
 */
for (const [why, item] of [
  ["the same mark nested", `<li><strong><strong>Text</strong></strong></li>`],
  ["a mark nested three deep", `<li><em><em><em>Text</em></em></em></li>`],
] as const) {
  test(`${why} is not read as a list`, () => {
    const { accepted } = extract(page(`      <ul>\n        ${item}\n        <li>Plain</li>\n      </ul>`));
    const asList = accepted.find(
      (candidate) =>
        candidate.kind === "rich_text" &&
        candidate.document.content.some((block) => block.type === "bullet_list"),
    );
    assert.equal(asList, undefined, `${why} was read as one list`);
  });
}

for (const [why, item] of [
  ["two different marks nested", `<li><strong><em>Text</em></strong></li>`],
] as const) {
  test(`${why} produces a document its own contract accepts`, () => {
    const root = mkdtempSync(join(tmpdir(), "managed-site-lists-marks-"));
    const file = join(root, "app/page.tsx");
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(
      file,
      `export default function Home() {\n  return (\n    <section id="terms">\n` +
        `      <ul>\n        ${item}\n        <li>Plain</li>\n      </ul>\n    </section>\n  );\n}\n`,
      "utf8",
    );
    const proposal = propose({
      repositoryRoot: root,
      configPath: null,
      ledgerPath: join(root, "idmap.json"),
    });
    const draft = proposal.contractDraft as {
      readonly pages: readonly {
        readonly sections: readonly {
          readonly fields: readonly { readonly id: string; readonly type: string }[];
        }[];
      }[];
    };
    const field = draft.pages
      .flatMap((each) => each.sections)
      .flatMap((each) => each.fields)
      .find((each) => each.type === "rich_text");
    assert.ok(field !== undefined, `no rich-text field for ${why}`);
    const value = proposal.contentDraft.values.find((each) => each.fieldId === field.id);
    assert.ok(value !== undefined, `no value for ${field.id}`);
    validateManagedFieldValue(field, value);
  });
}

/**
 * Everything the document cannot represent must fall back.
 *
 * The first version permitted whatever `#collectAttributes` discards, which
 * answers a different question: that set holds `id`, `role` and `type`, and
 * every one of them changes what this reading would have to reproduce. The
 * permitted set now says what is INERT, so an attribute nobody has thought of
 * yet falls back rather than being folded in silently.
 */
const LISTS_THAT_FALL_BACK: readonly (readonly [string, string])[] = [
  ["an ordered list starting at 3", `<ol start="3"><li>One</li><li>Two</li></ol>`],
  ["a reversed ordered list", `<ol reversed><li>One</li><li>Two</li></ol>`],
  ["an ordered list with a marker type", `<ol type="a"><li>One</li><li>Two</li></ol>`],
  ["items carrying durable ids", `<ul><li id="first">One</li><li id="second">Two</li></ul>`],
  ["an item with a role", `<ul><li role="none">One</li><li>Two</li></ul>`],
  ["an item with an attribute spread", `<ul><li {...rest}>One</li><li>Two</li></ul>`],
  ["a list with an attribute spread", `<ul {...rest}><li>One</li><li>Two</li></ul>`],
  ["a list carrying an id", `<ul id="terms-list"><li>One</li><li>Two</li></ul>`],
];

for (const [why, markup] of LISTS_THAT_FALL_BACK) {
  test(`${why} falls back to the ordinary walk`, () => {
    const source =
      `export function Page({ rest }: { rest: Record<string, unknown> }) {\n` +
      `  return (\n    <section id="terms">\n      ${markup}\n    </section>\n  );\n}\n`;
    assert.equal(listsIn(rawCandidates(source)).length, 0, `${why} was read as one list`);
  });
}

/**
 * A nested list, checked BEFORE the confidence gate.
 *
 * The outer list correctly falls back, and the ordinary walk then reaches the
 * inner `<ul>` and extracts THAT on its own — keeping half of a structure the
 * document cannot represent. The existing row asserted on accepted candidates,
 * where the gate happened to drop it for an unrelated reason, so it passed
 * while the defect was live.
 */
test("a nested list is not extracted from inside its parent's fallback", () => {
  const source =
    `export function Page() {\n  return (\n    <section id="terms">\n` +
    `      <ul><li>One</li><li>Two<ul><li>Nested</li></ul></li></ul>\n    </section>\n  );\n}\n`;
  assert.equal(listsIn(rawCandidates(source)).length, 0);
});

/** A plain list next to all of that is still one field, so the rows above
 * refuse for what they carry and not because the reading stopped working. */
test("a plain list beside the refused shapes is still one field", () => {
  const source =
    `export function Page() {\n  return (\n    <section id="terms">\n` +
    `      <ul className="a"><li className="b">One</li><li key="c">Two</li></ul>\n` +
    `    </section>\n  );\n}\n`;
  assert.equal(listsIn(rawCandidates(source)).length, 1);
});
