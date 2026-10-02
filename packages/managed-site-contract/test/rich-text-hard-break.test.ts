import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  groupManagedRichTextInlines,
  MANAGED_RICH_TEXT_BREAK_ATTRIBUTE,
  MANAGED_RICH_TEXT_MAX_HARD_BREAKS,
  managedRichTextBlockInlines,
  managedRichTextBreakAttributesV1,
  parseManagedFieldDescriptor,
  parseManagedRichTextConstraints,
  parseManagedRichTextDocument,
  parseManagedSiteContentDocument,
  parseManagedSiteContractV1,
  validateManagedFieldValue,
  validateManagedSiteContentDocumentJsonSchema,
  validateManagedSiteContractV1JsonSchema,
  type ManagedRichTextInline,
  type ManagedRichTextMark,
} from "../src/index.js";
import { summarizeManagedRichText } from "../src/rich-text.js";
import {
  contentDocument,
  managedSiteContract,
  richTextConstraints,
  richTextDocument,
  richTextField,
  stableId,
} from "./schema-fixtures.js";

/**
 * The hard break: a line break inside one block, stored as structure and never
 * as a control character. These cases are the ones the shared grammar table
 * cannot state, because it holds only documents under contracts this package
 * accepts: the field policy's own parse, the summary the size limits read, the
 * render tree, and the JSON Schema agreeing with the parser on all of it.
 */

type JsonObject = Record<string, unknown>;

const BREAK = { type: "hard_break" } as const;
const bold = { type: "bold" } as const;
const italic = { type: "italic" } as const;
const link: ManagedRichTextMark = {
  type: "link",
  destination: { kind: "external", url: "https://example.com/visit" },
  target: "same_window",
};

function text(value: string, ...marks: ManagedRichTextMark[]): ManagedRichTextInline {
  return marks.length === 0 ? { type: "text", text: value } : { type: "text", text: value, marks };
}

function paragraphDocument(...content: readonly unknown[]): JsonObject {
  return richTextDocument([{ type: "paragraph", content }]);
}

function accepts(check: () => unknown): boolean {
  try {
    check();
    return true;
  } catch {
    return false;
  }
}

describe("hard-break field policy", () => {
  const policies: readonly { readonly name: string; readonly policy: JsonObject; readonly valid: boolean }[] = [
    { name: "no hard-break policy", policy: {}, valid: true },
    { name: "an explicit opt-out", policy: { allowHardBreaks: false }, valid: true },
    { name: "an opt-in with no cap", policy: { allowHardBreaks: true }, valid: true },
    { name: "an opt-in capped at 1", policy: { allowHardBreaks: true, maxHardBreaks: 1 }, valid: true },
    { name: "an opt-in capped at 16", policy: { allowHardBreaks: true, maxHardBreaks: 16 }, valid: true },
    { name: "a cap of 0", policy: { allowHardBreaks: true, maxHardBreaks: 0 }, valid: false },
    { name: "a cap of 17", policy: { allowHardBreaks: true, maxHardBreaks: 17 }, valid: false },
    { name: "a negative cap", policy: { allowHardBreaks: true, maxHardBreaks: -1 }, valid: false },
    { name: "a fractional cap", policy: { allowHardBreaks: true, maxHardBreaks: 1.5 }, valid: false },
    { name: "a cap written as a string", policy: { allowHardBreaks: true, maxHardBreaks: "2" }, valid: false },
    { name: "a null cap", policy: { allowHardBreaks: true, maxHardBreaks: null }, valid: false },
    { name: "a cap with no opt-in", policy: { maxHardBreaks: 2 }, valid: false },
    { name: "a cap beside an explicit opt-out", policy: { allowHardBreaks: false, maxHardBreaks: 2 }, valid: false },
    { name: "an opt-in written as a string", policy: { allowHardBreaks: "true" }, valid: false },
    { name: "an opt-in written as 1", policy: { allowHardBreaks: 1 }, valid: false },
    { name: "a null opt-in", policy: { allowHardBreaks: null }, valid: false },
  ];

  for (const { name, policy, valid } of policies) {
    it(`${valid ? "accepts" : "refuses"} ${name}`, () => {
      const constraints = { ...richTextConstraints(), ...policy };
      assert.equal(accepts(() => parseManagedRichTextConstraints(constraints)), valid);
      const field = { ...richTextField(), constraints: { ...(richTextField().constraints as JsonObject), ...policy } };
      assert.equal(accepts(() => parseManagedFieldDescriptor(field)), valid);
    });
  }

  it("names the grammar's ceiling as the largest cap", () => {
    assert.equal(MANAGED_RICH_TEXT_MAX_HARD_BREAKS, 16);
  });
});

describe("hard-break documents under a field", () => {
  function fieldWith(policy: JsonObject): JsonObject {
    const field = richTextField();
    return { ...field, constraints: { ...(field.constraints as JsonObject), ...policy } };
  }

  function validates(policy: JsonObject, document: unknown): boolean {
    return accepts(() =>
      validateManagedFieldValue(fieldWith(policy), {
        fieldId: stableId("field"),
        owner: { kind: "site" },
        type: "rich_text",
        value: document,
      }),
    );
  }

  it("refuses a break without the opt-in and admits it with one", () => {
    const document = paragraphDocument(text("Grow your"), BREAK, text("business"));
    assert.equal(validates({}, document), false);
    assert.equal(validates({ allowHardBreaks: false }, document), false);
    assert.equal(validates({ allowHardBreaks: true }, document), true);
  });

  it("counts the cap over the whole document", () => {
    const twoBlocks = richTextDocument([
      { type: "paragraph", content: [text("A"), BREAK, text("B")] },
      { type: "bullet_list", content: [{ type: "list_item", content: [{ type: "paragraph", content: [text("C"), BREAK, text("D")] }] }] },
    ]);
    assert.equal(validates({ allowHardBreaks: true, maxHardBreaks: 2 }, twoBlocks), true);
    assert.equal(validates({ allowHardBreaks: true, maxHardBreaks: 1 }, twoBlocks), false);
  });

  it("parses placement and shape without a field, and leaves the opt-in to the field", () => {
    assert.doesNotThrow(() => parseManagedRichTextDocument(paragraphDocument(text("a"), BREAK, text("b"))));
    const refused: readonly unknown[] = [
      paragraphDocument(BREAK, text("b")),
      paragraphDocument(text("a"), BREAK),
      paragraphDocument(BREAK),
      paragraphDocument(text("a"), BREAK, BREAK, text("b")),
      paragraphDocument(text(""), BREAK, text("b")),
      paragraphDocument(text("a"), BREAK, text("")),
      paragraphDocument(text("a"), { ...BREAK, marks: [bold] }, text("b")),
      paragraphDocument(text("a"), { ...BREAK, attrs: {} }, text("b")),
      paragraphDocument(text("a\nb")),
      richTextDocument([BREAK]),
    ];
    for (const document of refused) {
      assert.throws(() => parseManagedRichTextDocument(document), JSON.stringify(document));
    }
  });
});

describe("summarizeManagedRichText with hard breaks", () => {
  it("counts a break as a node and no characters, and keeps it out of textNodes", () => {
    const document = parseManagedRichTextDocument(
      richTextDocument([
        { type: "heading", attrs: { level: 1 }, content: [text("Grow"), BREAK, text("your", bold)] },
        { type: "blockquote", content: [{ type: "paragraph", content: [text("A"), BREAK, text("B")] }] },
      ]),
    );
    const summary = summarizeManagedRichText(document);
    // doc; heading, 2 texts, 1 break; blockquote, paragraph, 2 texts, 1 break.
    assert.equal(summary.nodes, 10);
    assert.equal(summary.characters, "GrowyourAB".length);
    assert.equal(summary.hardBreaks, 2);
    assert.deepEqual(
      summary.textNodes.map((node) => node.text),
      ["Grow", "your", "A", "B"],
    );
  });
});

/**
 * The render contract. A break carries no marks, so where it renders is decided
 * by its neighbours: it renders inside every mark both of its neighbours share
 * from the outside in, which is where a site's `<strong>A<br>B</strong>` keeps
 * it, and outside every mark they do not.
 */
describe("groupManagedRichTextInlines with hard breaks", () => {
  const cases: readonly {
    readonly name: string;
    readonly inlines: readonly ManagedRichTextInline[];
    readonly expected: unknown;
  }[] = [
    {
      name: "a break between unmarked runs is a break between text",
      inlines: [text("Grow your"), BREAK, text("business")],
      expected: [
        { kind: "text", text: "Grow your" },
        { kind: "hard_break" },
        { kind: "text", text: "business" },
      ],
    },
    {
      name: "a break between runs sharing one mark renders inside that mark",
      inlines: [text("Grow your", bold), BREAK, text("business", bold)],
      expected: [
        {
          kind: "mark",
          mark: bold,
          children: [
            { kind: "text", text: "Grow your" },
            { kind: "hard_break" },
            { kind: "text", text: "business" },
          ],
        },
      ],
    },
    {
      name: "a break between different marks renders outside both",
      inlines: [text("Grow your", bold), BREAK, text("business", italic)],
      expected: [
        { kind: "mark", mark: bold, children: [{ kind: "text", text: "Grow your" }] },
        { kind: "hard_break" },
        { kind: "mark", mark: italic, children: [{ kind: "text", text: "business" }] },
      ],
    },
    {
      name: "a break renders inside only the outer marks its neighbours share",
      inlines: [text("a", bold, italic), BREAK, text("b", bold)],
      expected: [
        {
          kind: "mark",
          mark: bold,
          children: [
            { kind: "mark", mark: italic, children: [{ kind: "text", text: "a" }] },
            { kind: "hard_break" },
            { kind: "text", text: "b" },
          ],
        },
      ],
    },
    {
      name: "a break renders inside every mark its neighbours share, outermost first",
      inlines: [text("a", bold, italic), BREAK, text("b", bold, italic)],
      expected: [
        {
          kind: "mark",
          mark: bold,
          children: [
            {
              kind: "mark",
              mark: italic,
              children: [{ kind: "text", text: "a" }, { kind: "hard_break" }, { kind: "text", text: "b" }],
            },
          ],
        },
      ],
    },
    {
      name: "neighbours sharing a mark in a different order share no outer mark",
      inlines: [text("a", bold, italic), BREAK, text("b", italic, bold)],
      expected: [
        {
          kind: "mark",
          mark: bold,
          children: [{ kind: "mark", mark: italic, children: [{ kind: "text", text: "a" }] }],
        },
        { kind: "hard_break" },
        {
          kind: "mark",
          mark: italic,
          children: [{ kind: "mark", mark: bold, children: [{ kind: "text", text: "b" }] }],
        },
      ],
    },
    {
      name: "a break between one link's runs renders inside the link",
      inlines: [text("Visit", link), BREAK, text("us today", link)],
      expected: [
        {
          kind: "mark",
          mark: link,
          children: [{ kind: "text", text: "Visit" }, { kind: "hard_break" }, { kind: "text", text: "us today" }],
        },
      ],
    },
    {
      name: "two breaks inside one mark both render inside it",
      inlines: [text("a", bold), BREAK, text("b", bold), BREAK, text("c", bold)],
      expected: [
        {
          kind: "mark",
          mark: bold,
          children: [
            { kind: "text", text: "a" },
            { kind: "hard_break" },
            { kind: "text", text: "b" },
            { kind: "hard_break" },
            { kind: "text", text: "c" },
          ],
        },
      ],
    },
    {
      name: "a mark that ends at a break does not reach past the next one",
      inlines: [text("a", bold), BREAK, text("b", bold), BREAK, text("c")],
      expected: [
        {
          kind: "mark",
          mark: bold,
          children: [{ kind: "text", text: "a" }, { kind: "hard_break" }, { kind: "text", text: "b" }],
        },
        { kind: "hard_break" },
        { kind: "text", text: "c" },
      ],
    },
  ];
  for (const testCase of cases) {
    it(testCase.name, () => {
      assert.deepEqual(groupManagedRichTextInlines(testCase.inlines), testCase.expected);
    });
  }

  it("reads a one-block field's breaks along with its text", () => {
    const content = [text("Grow your"), BREAK, text("business", italic)];
    assert.deepEqual(
      managedRichTextBlockInlines({ type: "doc", content: [{ type: "heading", attrs: { level: 1 }, content }] }),
      content,
    );
  });

  it("names a rendered break with data-gomega-break", () => {
    assert.equal(MANAGED_RICH_TEXT_BREAK_ATTRIBUTE, "data-gomega-break");
    assert.deepEqual(managedRichTextBreakAttributesV1(), { "data-gomega-break": "" });
    assert.ok(Object.isFrozen(managedRichTextBreakAttributesV1()));
  });
});

/**
 * The JSON Schema bundle is what a non-TypeScript consumer validates with, so
 * it must reach the parser's verdict on every hard-break shape: the node, its
 * placement, the control characters it replaces, and the field policy.
 */
describe("hard-break JSON Schema parity", () => {
  function contentWith(document: unknown): JsonObject {
    const content = contentDocument();
    content.values = [
      { fieldId: stableId("field"), owner: { kind: "site" }, type: "rich_text", value: document },
    ];
    return content;
  }

  const documents: readonly { readonly name: string; readonly document: unknown; readonly valid: boolean }[] = [
    { name: "a break between runs", document: paragraphDocument(text("a"), BREAK, text("b")), valid: true },
    {
      name: "a break in a heading",
      document: richTextDocument([{ type: "heading", attrs: { level: 1 }, content: [text("a"), BREAK, text("b")] }]),
      valid: true,
    },
    { name: "a line separator in text", document: paragraphDocument(text("a b")), valid: true },
    { name: "a leading break", document: paragraphDocument(BREAK, text("b")), valid: false },
    { name: "a trailing break", document: paragraphDocument(text("a"), BREAK), valid: false },
    { name: "a lone break", document: paragraphDocument(BREAK), valid: false },
    { name: "adjacent breaks", document: paragraphDocument(text("a"), BREAK, BREAK, text("b")), valid: false },
    { name: "a break after empty text", document: paragraphDocument(text(""), BREAK, text("b")), valid: false },
    { name: "breaks around empty text", document: paragraphDocument(text("a"), BREAK, text(""), BREAK, text("b")), valid: false },
    { name: "empty text away from any break", document: paragraphDocument(text(""), text("b")), valid: true },
    { name: "a break with marks", document: paragraphDocument(text("a"), { ...BREAK, marks: [bold] }, text("b")), valid: false },
    { name: "a break with empty marks", document: paragraphDocument(text("a"), { ...BREAK, marks: [] }, text("b")), valid: false },
    { name: "a break with attrs", document: paragraphDocument(text("a"), { ...BREAK, attrs: {} }, text("b")), valid: false },
    { name: "a break with text", document: paragraphDocument(text("a"), { ...BREAK, text: "\n" }, text("b")), valid: false },
    { name: "a hardBreak node", document: paragraphDocument(text("a"), { type: "hardBreak" }, text("b")), valid: false },
    { name: "a top-level break", document: richTextDocument([BREAK]), valid: false },
    {
      name: "a break directly in a list item",
      document: richTextDocument([
        { type: "bullet_list", content: [{ type: "list_item", content: [{ type: "paragraph", content: [text("a")] }, BREAK] }] },
      ]),
      valid: false,
    },
    { name: "a newline in text", document: paragraphDocument(text("a\nb")), valid: false },
    { name: "a tab in text", document: paragraphDocument(text("a\tb")), valid: false },
    { name: "a C1 control in text", document: paragraphDocument(text("a\u0085b")), valid: false },
    { name: "a delete control in text", document: paragraphDocument(text("a\u007fb")), valid: false },
  ];

  for (const { name, document, valid } of documents) {
    it(`agrees on content holding ${name}`, () => {
      const content = contentWith(document);
      assert.equal(accepts(() => parseManagedSiteContentDocument(content)), valid, "parser");
      assert.equal(validateManagedSiteContentDocumentJsonSchema(content).valid, valid, "JSON Schema");
    });
  }

  function contractWithPolicy(policy: JsonObject): JsonObject {
    const contract = managedSiteContract();
    const pages = contract.pages as JsonObject[];
    const sections = pages[0]!.sections as JsonObject[];
    const fields = sections[0]!.fields as JsonObject[];
    const rich = fields.find((field) => field.type === "rich_text")!;
    Object.assign(rich.constraints as JsonObject, policy);
    return contract;
  }

  const policies: readonly { readonly name: string; readonly policy: JsonObject; readonly valid: boolean }[] = [
    { name: "an opt-in", policy: { allowHardBreaks: true }, valid: true },
    { name: "a capped opt-in", policy: { allowHardBreaks: true, maxHardBreaks: 16 }, valid: true },
    { name: "an opt-out", policy: { allowHardBreaks: false }, valid: true },
    { name: "a cap over the ceiling", policy: { allowHardBreaks: true, maxHardBreaks: 17 }, valid: false },
    { name: "a zero cap", policy: { allowHardBreaks: true, maxHardBreaks: 0 }, valid: false },
    { name: "a cap without the opt-in", policy: { maxHardBreaks: 2 }, valid: false },
    { name: "a string opt-in", policy: { allowHardBreaks: "true" }, valid: false },
  ];

  for (const { name, policy, valid } of policies) {
    it(`agrees on a contract declaring ${name}`, () => {
      const contract = contractWithPolicy(policy);
      assert.equal(accepts(() => parseManagedSiteContractV1(contract)), valid, "parser");
      assert.equal(validateManagedSiteContractV1JsonSchema(contract).valid, valid, "JSON Schema");
    });
  }
});
