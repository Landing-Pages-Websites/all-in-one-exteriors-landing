import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import ts from "typescript";

import type { Candidate, RichTextCandidate } from "../src/candidates.js";
import { jsxTextValue } from "../src/inline-block.js";
import type { Finding } from "../src/report.js";
import { configFor, extractModule, run, workspace } from "./support/proposals.js";

/**
 * The claim under test: one visual text block is exactly one managed field.
 *
 * A heading or paragraph whose text is interrupted by inline formatting used to
 * become one field per text run: All Points Media's
 * `<h2>Custom activations <span className="italic">built around...</span></h2>`
 * was two fields, "Heading text" and "Heading text". A block whose inline
 * children all map to a mark is now ONE `rich_text` field holding one block,
 * and a block with anything the converter cannot map is refused whole, never
 * split and never guessed.
 *
 * The rows cover what inline formatting can look like in JSX, and the outcome
 * of each is anchored on what the converter emitted before this change
 * (`plain_text` and `heading_text` rows are unchanged; the rest were either
 * split into fragments or refused).
 */

const UNMAPPED = "INLINE_FORMATTING_UNMAPPED";

interface Reading {
  readonly candidates: readonly Candidate[];
  readonly findings: readonly Finding[];
}

function read(body: string): Reading {
  return extractModule(
    `export function Component() {\n  return (\n    <section id="s">\n      ${body}\n    </section>\n  );\n}\n`,
  );
}

function richOf(reading: Reading): RichTextCandidate {
  const rich = reading.candidates.filter(
    (candidate): candidate is RichTextCandidate => candidate.kind === "rich_text",
  );
  assert.equal(rich.length, 1, `expected one rich_text field, got ${describe(reading)}`);
  return rich[0]!;
}

function describe(reading: Reading): string {
  return JSON.stringify({
    candidates: reading.candidates.map((candidate) => candidate.kind),
    findings: reading.findings.map((finding) => `${finding.code}: ${finding.decision}`),
  });
}

function textFields(reading: Reading): readonly string[] {
  return reading.candidates.flatMap((candidate) =>
    candidate.kind === "plain_text" || candidate.kind === "heading_text"
      ? [candidate.value]
      : [],
  );
}

const italic = { type: "italic" } as const;
const bold = { type: "bold" } as const;

interface AcceptedRow {
  readonly name: string;
  readonly body: string;
  readonly block: unknown;
  readonly templates: Readonly<Record<string, { open: string; close: string }>>;
}

const BREAK = { type: "hard_break" } as const;
const BR = { open: `<br data-gomega-break="" />`, close: "" };

/**
 * A line break inside a block is a `hard_break` between two runs, rendered
 * through the source's own `<br>` (its attributes kept, the break annotation
 * added), so the rewritten block draws the same lines.
 */
const LINE_BREAKS: readonly AcceptedRow[] = [
  {
    name: "a line break inside a heading is a hard break between its runs",
    body: `<h2>One audience.<br />Many moments.</h2>`,
    block: {
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "One audience." }, BREAK, { type: "text", text: "Many moments." }],
    },
    templates: { hard_break: BR },
  },
  {
    name: "a line break beside a styled span",
    body: `<h2>One audience.<br /><span className="italic">Many moments.</span></h2>`,
    block: {
      type: "heading",
      attrs: { level: 2 },
      content: [
        { type: "text", text: "One audience." },
        BREAK,
        { type: "text", text: "Many moments.", marks: [italic] },
      ],
    },
    templates: {
      hard_break: BR,
      italic: { open: `<span className="italic" data-gomega-mark="italic">`, close: "</span>" },
    },
  },
  {
    name: "an h1 drawn on three lines",
    body: `<h1>Grow your<br />business<br />with us</h1>`,
    block: {
      type: "heading",
      attrs: { level: 1 },
      content: [
        { type: "text", text: "Grow your" },
        BREAK,
        { type: "text", text: "business" },
        BREAK,
        { type: "text", text: "with us" },
      ],
    },
    templates: { hard_break: BR },
  },
  {
    name: "a line break keeps its own class, so a responsive break stays responsive",
    body: `<h1>Grow your <br className="hidden md:block" />business</h1>`,
    block: {
      type: "heading",
      attrs: { level: 1 },
      content: [{ type: "text", text: "Grow your " }, BREAK, { type: "text", text: "business" }],
    },
    templates: {
      hard_break: { open: `<br className="hidden md:block" data-gomega-break="" />`, close: "" },
    },
  },
  {
    name: "a line break written without a space keeps its spelling",
    body: `<p>One<br/>Two</p>`,
    block: {
      type: "paragraph",
      content: [{ type: "text", text: "One" }, BREAK, { type: "text", text: "Two" }],
    },
    templates: { hard_break: { open: `<br data-gomega-break=""/>`, close: "" } },
  },
  {
    name: "a line break inside a mark renders inside it",
    body: `<p><strong>Grow<br />more</strong> today</p>`,
    block: {
      type: "paragraph",
      content: [
        { type: "text", text: "Grow", marks: [bold] },
        BREAK,
        { type: "text", text: "more", marks: [bold] },
        { type: "text", text: " today" },
      ],
    },
    templates: { bold: { open: `<strong data-gomega-mark="bold">`, close: "</strong>" }, hard_break: BR },
  },
  {
    name: "a line break inside a link renders inside it",
    body: `<p><a href="https://example.com/visit">Visit<br />us</a> now</p>`,
    block: {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "Visit",
          marks: [{ type: "link", destination: { kind: "external", url: "https://example.com/visit" }, target: "same_window" }],
        },
        BREAK,
        {
          type: "text",
          text: "us",
          marks: [{ type: "link", destination: { kind: "external", url: "https://example.com/visit" }, target: "same_window" }],
        },
        { type: "text", text: " now" },
      ],
    },
    templates: {
      hard_break: BR,
      link: {
        open: `<a href={link.href} target={link.target} rel={link.rel} data-gomega-mark="link">`,
        close: "</a>",
      },
    },
  },
];

const ACCEPTED: readonly AcceptedRow[] = [
  {
    name: "a heading with a styled span is one heading block at its level",
    body: `<h2>Custom activations <span className="italic text-accent">built around you</span></h2>`,
    block: {
      type: "heading",
      attrs: { level: 2 },
      content: [
        { type: "text", text: "Custom activations " },
        { type: "text", text: "built around you", marks: [italic] },
      ],
    },
    templates: {
      italic: {
        open: `<span className="italic text-accent" data-gomega-mark="italic">`,
        close: "</span>",
      },
    },
  },
  {
    name: "a level 3 heading with a strong element",
    body: `<h3>Built <strong>right</strong></h3>`,
    block: {
      type: "heading",
      attrs: { level: 3 },
      content: [
        { type: "text", text: "Built " },
        { type: "text", text: "right", marks: [bold] },
      ],
    },
    templates: { bold: { open: `<strong data-gomega-mark="bold">`, close: "</strong>" } },
  },
  {
    // All Points Media's hero headings: an `h1` with a styled span is one
    // heading block at level 1.
    name: "an h1 with a styled span is one level 1 heading block",
    body: `<h1>Big <span className="italic">title</span></h1>`,
    block: {
      type: "heading",
      attrs: { level: 1 },
      content: [
        { type: "text", text: "Big " },
        { type: "text", text: "title", marks: [italic] },
      ],
    },
    templates: {
      italic: { open: `<span className="italic" data-gomega-mark="italic">`, close: "</span>" },
    },
  },
  {
    // Below level 3 the contract admits no heading block. The element keeps its
    // own level in code, so the content is a paragraph.
    name: "an h4 with a styled span is one paragraph block",
    body: `<h4>Small <span className="italic">print</span></h4>`,
    block: {
      type: "paragraph",
      content: [
        { type: "text", text: "Small " },
        { type: "text", text: "print", marks: [italic] },
      ],
    },
    templates: {
      italic: { open: `<span className="italic" data-gomega-mark="italic">`, close: "</span>" },
    },
  },
  {
    name: "a paragraph with em, strong and an external link",
    body: `<p>Read <em>this</em>, <strong>that</strong> and <a className="underline" href="https://example.com/more">more</a>.</p>`,
    block: {
      type: "paragraph",
      content: [
        { type: "text", text: "Read " },
        { type: "text", text: "this", marks: [italic] },
        { type: "text", text: ", " },
        { type: "text", text: "that", marks: [bold] },
        { type: "text", text: " and " },
        {
          type: "text",
          text: "more",
          marks: [
            {
              type: "link",
              destination: { kind: "external", url: "https://example.com/more" },
              target: "same_window",
            },
          ],
        },
        { type: "text", text: "." },
      ],
    },
    templates: {
      italic: { open: `<em data-gomega-mark="italic">`, close: "</em>" },
      bold: { open: `<strong data-gomega-mark="bold">`, close: "</strong>" },
      link: {
        // rel={link.rel} is appended where the source wrote none: it renders
        // only for a new window, where a customer's switch to one needs it.
        open: `<a className="underline" href={link.href} target={link.target} rel={link.rel} data-gomega-mark="link">`,
        close: "</a>",
      },
    },
  },
  {
    name: "a new-window link keeps its target and rel in the template",
    body: `<p>See <a href="https://example.com/" target="_blank" rel="noopener">us</a></p>`,
    block: {
      type: "paragraph",
      content: [
        { type: "text", text: "See " },
        {
          type: "text",
          text: "us",
          marks: [
            {
              type: "link",
              destination: { kind: "external", url: "https://example.com/" },
              target: "new_window",
            },
          ],
        },
      ],
    },
    templates: {
      link: {
        open: `<a href={link.href} target={link.target} rel="noopener" data-gomega-mark="link">`,
        close: "</a>",
      },
    },
  },
  {
    name: "nested marks carry both kinds, outermost first",
    body: `<p>Some <strong>bold <em>and italic</em></strong> text</p>`,
    block: {
      type: "paragraph",
      content: [
        { type: "text", text: "Some " },
        { type: "text", text: "bold ", marks: [bold] },
        { type: "text", text: "and italic", marks: [bold, italic] },
        { type: "text", text: " text" },
      ],
    },
    templates: {
      bold: { open: `<strong data-gomega-mark="bold">`, close: "</strong>" },
      italic: { open: `<em data-gomega-mark="italic">`, close: "</em>" },
    },
  },
  {
    name: "whitespace at run boundaries stays where the source put it",
    body: `<p>Before<em> inside </em>after</p>`,
    block: {
      type: "paragraph",
      content: [
        { type: "text", text: "Before" },
        { type: "text", text: " inside ", marks: [italic] },
        { type: "text", text: "after" },
      ],
    },
    templates: { italic: { open: `<em data-gomega-mark="italic">`, close: "</em>" } },
  },
  {
    name: "an explicit space expression between a run and a mark",
    body: `<p>\n        Hello{" "}\n        <b>world</b>\n      </p>`,
    block: {
      type: "paragraph",
      content: [
        { type: "text", text: "Hello " },
        { type: "text", text: "world", marks: [bold] },
      ],
    },
    templates: { bold: { open: `<b data-gomega-mark="bold">`, close: "</b>" } },
  },
  {
    name: "a block that is only one inline element",
    body: `<p><em>All of it</em></p>`,
    block: {
      type: "paragraph",
      content: [{ type: "text", text: "All of it", marks: [italic] }],
    },
    templates: { italic: { open: `<em data-gomega-mark="italic">`, close: "</em>" } },
  },
  {
    name: "a button label with a bold class",
    body: `<button type="button">Get <span className="font-bold">started</span></button>`,
    block: {
      type: "paragraph",
      content: [
        { type: "text", text: "Get " },
        { type: "text", text: "started", marks: [bold] },
      ],
    },
    templates: {
      bold: { open: `<span className="font-bold" data-gomega-mark="bold">`, close: "</span>" },
    },
  },
  {
    name: "formatted runs in a container are one block",
    body: `<div><strong>Free</strong> <em>shipping</em></div>`,
    block: {
      type: "paragraph",
      content: [
        { type: "text", text: "Free", marks: [bold] },
        { type: "text", text: " " },
        { type: "text", text: "shipping", marks: [italic] },
      ],
    },
    templates: {
      bold: { open: `<strong data-gomega-mark="bold">`, close: "</strong>" },
      italic: { open: `<em data-gomega-mark="italic">`, close: "</em>" },
    },
  },
  {
    name: "a reference only HTML5 knows stays as the compiler leaves it",
    body: `<p>A &check; &#x2603; <em>b</em></p>`,
    block: {
      type: "paragraph",
      content: [
        { type: "text", text: "A &check; \u2603 " },
        { type: "text", text: "b", marks: [italic] },
      ],
    },
    templates: { italic: { open: `<em data-gomega-mark="italic">`, close: "</em>" } },
  },
  ...LINE_BREAKS,
  {
    name: "an HTML entity decodes into the text it renders",
    body: `<p>Fish &amp; <i>chips</i></p>`,
    block: {
      type: "paragraph",
      content: [
        { type: "text", text: "Fish & " },
        { type: "text", text: "chips", marks: [italic] },
      ],
    },
    templates: { italic: { open: `<i data-gomega-mark="italic">`, close: "</i>" } },
  },
];

for (const row of ACCEPTED) {
  test(`accepted: ${row.name}`, () => {
    const reading = read(row.body);
    const rich = richOf(reading);
    assert.deepEqual(rich.document, { type: "doc", content: [row.block] });
    assert.deepEqual(rich.templates, row.templates);
    assert.deepEqual(
      reading.candidates.map((candidate) => candidate.kind),
      ["rich_text"],
      "no fragment of the block, and no link inside it, is a field of its own",
    );
    assert.deepEqual(
      reading.findings.filter((finding) => finding.code === UNMAPPED),
      [],
    );
  });
}

interface RefusedRow {
  readonly name: string;
  readonly body: string;
  /** A fragment of the reason, so a refusal for the wrong reason fails. */
  readonly because: string;
}

const REFUSED: readonly RefusedRow[] = [
  {
    name: "a span whose classes carry no formatting meaning",
    body: `<p>Hello <span className="text-accent">world</span></p>`,
    because: "no mark",
  },
  {
    name: "a span that hides text from sighted readers",
    body: `<p>Call <span className="sr-only">our office</span> now</p>`,
    because: "no mark",
  },
  {
    name: "a span that is only italic at a breakpoint",
    body: `<p>Hello <span className="md:italic">world</span></p>`,
    because: "breakpoint or state",
  },
  {
    name: "a span that turns italic off",
    body: `<p>Hello <span className="not-italic">world</span></p>`,
    because: "breakpoint or state",
  },
  {
    name: "a span carrying both italic and bold at once",
    body: `<p>Hello <span className="italic font-bold">world</span></p>`,
    because: "more than one mark",
  },
  {
    name: "a span whose class is computed",
    body: `<p>Hello <span className={tone}>world</span></p>`,
    because: "not a literal",
  },
  {
    name: "a mark element with a spread",
    body: `<p>Hello <em {...rest}>world</em></p>`,
    because: "not a literal",
  },
  {
    name: "a line break leading a block",
    body: `<h2><br />Many moments.</h2>`,
    because: "contract refuses",
  },
  {
    name: "a line break ending a block",
    body: `<p>Many moments.<br /></p>`,
    because: "contract refuses",
  },
  {
    name: "two line breaks in a row, an empty line no break can say",
    body: `<p>One<br /><br />Two</p>`,
    because: "contract refuses",
  },
  {
    name: "a line break between two elements of one mark",
    body: `<p><strong>One</strong><br /><strong>Two</strong> end</p>`,
    because: "renders differently",
  },
  {
    name: "two line breaks written two ways in one block",
    body: `<p>One<br />Two<br className="md:hidden" />Three</p>`,
    because: "renders differently",
  },
  {
    name: "a line break whose class is computed",
    body: `<p>One<br className={tone} />Two</p>`,
    because: "not a literal",
  },
  {
    name: "a line break with a spread",
    body: `<p>One<br {...rest} />Two</p>`,
    because: "not a literal",
  },
  {
    name: "a line break with children",
    body: `<p>One<br>x</br>Two</p>`,
    because: "line break",
  },
  {
    name: "a newline written as an expression",
    body: `<p>One{"\\n"}<em>Two</em></p>`,
    because: "contract refuses",
  },
  {
    name: "a character reference to a C1 control",
    body: `<p>A &#x80; <em>b</em></p>`,
    because: "contract refuses",
  },
  {
    name: "a component inside a block",
    body: `<p>Hello <Tooltip>world</Tooltip></p>`,
    because: "no mark",
  },
  {
    name: "adjacent runs of the same mark, which one run cannot reproduce",
    body: `<p><em>one</em><em>two</em> end</p>`,
    because: "renders differently",
  },
  {
    name: "the same mark nested inside itself",
    body: `<p><strong><strong>twice</strong></strong> bold</p>`,
    because: "inside itself",
  },
  {
    name: "one mark written two different ways in one block",
    body: `<p><em>one</em> and <i>two</i></p>`,
    because: "renders differently",
  },
  {
    name: "an empty mark element",
    body: `<p>Hello <em></em><strong>world</strong></p>`,
    because: "renders differently",
  },
  {
    name: "a link to a page of this site",
    body: `<p>Read <a href="/about">about us</a></p>`,
    because: "link",
  },
  {
    name: "a link to a fragment",
    body: `<p>Jump <a href="#faq">down</a></p>`,
    because: "link",
  },
  {
    name: "a link whose target is not one the contract can state",
    body: `<p>See <a href="https://example.com/" target="_self">us</a></p>`,
    because: "renders differently",
  },
  {
    name: "an email link carrying a query the contract cannot hold",
    body: `<p>Mail <a href="mailto:hi@example.com?subject=Hi">us</a> now.</p>`,
    because: "contract refuses",
  },
  {
    name: "a phone link written with punctuation",
    body: `<p>Call <a href="tel:+1 (555) 123-4567">us</a> now.</p>`,
    because: "contract refuses",
  },
  {
    name: "a URL with a space in it",
    body: `<p>See <a href="https://example.com/a b">this</a> now.</p>`,
    because: "contract refuses",
  },
  {
    name: "an href carrying a character reference",
    body: `<p>See <a href="https://example.com/?a=1&amp;b=2">this</a> now.</p>`,
    because: "character reference",
  },
  {
    name: "a link whose destination is computed",
    body: `<p>See <a href={url}>us</a></p>`,
    because: "link",
  },
];

for (const row of REFUSED) {
  test(`refused: ${row.name}`, () => {
    const reading = read(row.body);
    assert.deepEqual(
      reading.candidates.filter((candidate) => candidate.kind === "rich_text"),
      [],
      `no rich_text field: ${describe(reading)}`,
    );
    assert.deepEqual(
      reading.candidates.filter((candidate) => candidate.kind !== "collection"),
      [],
      `and no fragments: ${describe(reading)}`,
    );
    const refusals = reading.findings.filter((finding) => finding.code === UNMAPPED);
    assert.equal(refusals.length, 1, `one refusal: ${describe(reading)}`);
    assert.match(refusals[0]!.decision, new RegExp(row.because, "u"));
  });
}

test("a computed value inside a formatted block is still reported as non-literal", () => {
  const reading = read(`<p>Hello <em>{name}</em></p>`);
  assert.equal(reading.candidates.some((candidate) => candidate.kind === "rich_text"), false);
  assert.equal(
    reading.findings.some((finding) => finding.code === "NON_LITERAL_VALUE"),
    true,
    describe(reading),
  );
});

test("a plain paragraph and a plain heading are unchanged", () => {
  const reading = read(`<div><h2>Plain heading</h2><p>Plain text</p></div>`);
  assert.deepEqual(
    reading.candidates.map((candidate) => candidate.kind),
    ["heading_text", "plain_text"],
  );
  assert.deepEqual(textFields(reading), ["Plain heading", "Plain text"]);
});

/**
 * What is NOT a formatted block keeps the reading it always had: a decorative
 * child holds no text, a container holds no text of its own, and a paragraph
 * that is only a link is that link.
 */
const UNCHANGED: readonly { readonly name: string; readonly body: string; readonly kinds: readonly string[] }[] = [
  { name: "a heading beside an icon", body: `<h3><Icon /> Services</h3>`, kinds: ["heading_text"] },
  { name: "a heading beside an empty dot", body: `<h3><span className="dot" /> Services</h3>`, kinds: ["heading_text"] },
  { name: "a container of labelled spans", body: `<div><span>One</span><span>Two</span></div>`, kinds: ["plain_text", "plain_text"] },
  { name: "a paragraph that is only a link", body: `<p><a href="https://example.com/">Read more</a></p>`, kinds: ["link"] },
  { name: "a button that is only a span", body: `<button><span>Go</span></button>`, kinds: ["plain_text"] },
  { name: "a lone bold value in a container", body: `<div><strong>$99</strong></div>`, kinds: ["rich_text"] },
  { name: "decoration beside a label", body: `<p>Next <span aria-hidden="true">→</span></p>`, kinds: ["plain_text"] },
];

/**
 * A child that is a block of its own makes its parent a container. This used to
 * read the parent as one formatted block and then refuse it for holding a
 * paragraph, which lost the paragraph too; each child is now read on its own.
 */
test("a formatted title beside a block of its own is a container of blocks", () => {
  const reading = read(`<div><strong>Title</strong> <em>note</em><p>Body</p></div>`);
  assert.deepEqual(textFields(reading), ["Title", "note", "Body"], describe(reading));
});

for (const row of UNCHANGED) {
  test(`unchanged: ${row.name}`, () => {
    const reading = read(row.body);
    assert.deepEqual(reading.candidates.map((candidate) => candidate.kind), row.kinds, describe(reading));
  });
}

test("a static list stays one list document, its item marks mapped the same way", () => {
  const rich = richOf(
    read(`<ul><li>First <span className="italic">item</span></li><li>Second</li></ul>`),
  );
  assert.deepEqual(rich.document, {
    type: "doc",
    content: [
      {
        type: "bullet_list",
        content: [
          {
            type: "list_item",
            content: [
              {
                type: "paragraph",
                content: [
                  { type: "text", text: "First " },
                  { type: "text", text: "item", marks: [italic] },
                ],
              },
            ],
          },
          {
            type: "list_item",
            content: [{ type: "paragraph", content: [{ type: "text", text: "Second" }] }],
          },
        ],
      },
    ],
  });
  // A list document is not one inline block, so nothing renders it in place.
  assert.equal(rich.templates, null);
});

test("an identified list item is its own block", () => {
  const reading = read(`<ul><li id="first">One <em>item</em></li><li id="second">Two</li></ul>`);
  const rich = richOf(reading);
  assert.deepEqual(rich.document, {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "One " },
          { type: "text", text: "item", marks: [italic] },
        ],
      },
    ],
  });
  assert.deepEqual(textFields(reading), ["Two"]);
});

test("a link label of two spans is the link field alone, with no fragments", () => {
  const reading = read(`<a href="https://example.com/"><span>Trend</span><span>Candy</span></a>`);
  assert.deepEqual(reading.candidates.map((candidate) => candidate.kind), ["link"], describe(reading));
});

test("whitespace at a block's own edges is kept exactly as JSX renders it", () => {
  const rich = richOf(read(`<p> Lead <em>in</em> </p>`));
  assert.deepEqual(rich.document, {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: " Lead " },
          { type: "text", text: "in", marks: [italic] },
          { type: "text", text: " " },
        ],
      },
    ],
  });
});

/**
 * A link field's label is plain text, so a formatted label is ONE rich-text
 * field of its own, rendered in place inside the link, beside the link field
 * that keeps the destination.
 */
test("a formatted link label is one rich-text field beside the link", () => {
  const reading = read(
    `<a href="https://example.com/"><span className="italic">Learn</span> more</a>`,
  );
  assert.deepEqual(
    reading.candidates.map((candidate) => candidate.kind),
    ["link", "rich_text"],
    describe(reading),
  );
  const rich = richOf(reading);
  assert.deepEqual(rich.document, {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Learn", marks: [italic] },
          { type: "text", text: " more" },
        ],
      },
    ],
  });
});

/**
 * A link label has exactly one editor, whatever wraps its text: the link field
 * when the label is bare text, a rich-text field when it is formatted (by a tag
 * or by a span's class, alone or beside text), and the text's own field when
 * it sits beside other elements.
 */
const LABELS: readonly {
  readonly name: string;
  readonly body: string;
  readonly kinds: readonly string[];
  readonly linkEditsLabel: boolean;
}[] = [
  { name: "bare text", body: `<a href="https://example.com/">Learn more</a>`, kinds: ["link"], linkEditsLabel: true },
  { name: "one italic span alone", body: `<a href="https://example.com/"><span className="italic">Learn</span></a>`, kinds: ["link", "rich_text"], linkEditsLabel: false },
  { name: "one bold span alone", body: `<a href="https://example.com/"><span className="font-bold">Learn</span></a>`, kinds: ["link", "rich_text"], linkEditsLabel: false },
  { name: "one em alone", body: `<a href="https://example.com/"><em>Learn</em></a>`, kinds: ["link", "rich_text"], linkEditsLabel: false },
  { name: "an italic span beside text", body: `<a href="https://example.com/"><span className="italic">Learn</span> more</a>`, kinds: ["link", "rich_text"], linkEditsLabel: false },
  { name: "text beside an icon", body: `<a href="https://example.com/"><Icon /> Learn</a>`, kinds: ["link", "plain_text"], linkEditsLabel: false },
  { name: "text in a plain span", body: `<a href="https://example.com/"><span>Learn</span></a>`, kinds: ["link", "plain_text"], linkEditsLabel: false },
];

for (const row of LABELS) {
  test(`a link label as ${row.name} has one editor`, () => {
    const space = workspace("formattedblocks", configFor(["/"]));
    const file = join(space.repositoryRoot, "app/page.tsx");
    writeFileSync(
      file,
      `export default function Home() {\n  return (\n    <main>\n      <section id="s">\n        ${row.body}\n      </section>\n    </main>\n  );\n}\n`,
    );
    writeFileSync(join(space.repositoryRoot, "components/Aside.tsx"), "export function Aside() { return null; }\n");
    const proposal = run(space);
    const draft = proposal.contractDraft as unknown as {
      readonly pages: readonly { readonly sections: readonly { readonly fields: readonly { readonly type: string; readonly capabilities: readonly string[] }[] }[] }[];
    };
    const fields = draft.pages.flatMap((page) => page.sections).flatMap((section) => section.fields);
    assert.deepEqual(fields.map((field) => field.type).sort(), [...row.kinds].sort());
    const link = fields.find((field) => field.type === "link")!;
    assert.equal(link.capabilities.includes("link.label.edit"), row.linkEditsLabel);
  });
}

test("a link inside a link label is refused, not nested", () => {
  const reading = read(
    `<a href="https://example.com/">Go <a href="https://example.com/b">there</a></a>`,
  );
  assert.equal(reading.candidates.some((candidate) => candidate.kind === "rich_text"), false);
  assert.ok(reading.findings.some((finding) => finding.code === UNMAPPED), describe(reading));
});

/**
 * The value must be the text the page renders, byte for byte, or the rewritten
 * element renders something else. The oracle is the TypeScript compiler's own
 * JSX transform rather than a restatement of its whitespace rules.
 */
const JSX_TEXTS: readonly string[] = [
  " ",
  "  two  spaces  ",
  "\n  Leading line",
  "Trailing line\n  ",
  "\n    Custom signage \n  ",
  "a\n\n   b",
  "tab\there",
  "a\t\n\tb",
  "\t lead\n",
  "x \t\n  y",
  " \n ",
  "Fish &amp; chips&nbsp;",
  "\r\n  crlf\r\n  lines\r\n",
];

function compiledText(raw: string): string {
  const output = ts.transpileModule(`<p>${raw}</p>;`, {
    compilerOptions: { jsx: ts.JsxEmit.React },
    fileName: "text.tsx",
  }).outputText;
  const match = /React\.createElement\("p", null(?:, ("(?:[^"\\]|\\.)*"))?\)/u.exec(output);
  assert.ok(match !== null, output);
  return match[1] === undefined ? "" : (JSON.parse(match[1]) as string);
}

for (const raw of JSX_TEXTS) {
  test(`JSX text ${JSON.stringify(raw)} reads as the compiler renders it`, () => {
    assert.equal(jsxTextValue(raw), compiledText(raw));
  });
}

/**
 * Where the two compilers part: TypeScript trims a non-breaking space at a
 * line's edge and Next's compiler (SWC) keeps it. A converted site is built by
 * Next, so its rule is the one the value follows.
 */
test("a non-breaking space at a line's edge is kept, as Next's compiler keeps it", () => {
  assert.equal(jsxTextValue("a\u00a0\nb"), "a\u00a0 b");
});
