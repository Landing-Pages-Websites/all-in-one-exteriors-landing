import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  groupManagedRichTextInlines,
  MANAGED_RICH_TEXT_HEADING_LEVELS,
  MANAGED_RICH_TEXT_MARK_ATTRIBUTE,
  ManagedSiteContractError,
  managedRichTextBlockInlines,
  managedRichTextLinkAttributesV1,
  managedRichTextMarkAttributesV1,
  parseManagedFieldDescriptor,
  parseManagedRichTextConstraints,
  parseManagedRichTextDocument,
  validateManagedFieldValue,
  type ManagedRichTextDocument,
  type ManagedRichTextInline,
  type ManagedRichTextMark,
} from "../src/index.js";
import { richTextField, stableId } from "./schema-fixtures.js";

const bold = { type: "bold" } as const;
const italic = { type: "italic" } as const;
const link = (url: string): ManagedRichTextMark => ({
  type: "link",
  destination: { kind: "external", url },
  target: "same_window",
});

function text(value: string, ...marks: ManagedRichTextMark[]): ManagedRichTextInline {
  return marks.length === 0 ? { type: "text", text: value } : { type: "text", text: value, marks };
}

/**
 * Grouping is what makes a rendered block reproduce its source: a run of text
 * sharing an outer mark renders inside ONE element, not one element per run,
 * or `<strong>bold <em>and italic</em></strong>` would come back as two
 * `<strong>` elements.
 */
describe("groupManagedRichTextInlines", () => {
  const cases: readonly {
    readonly name: string;
    readonly inlines: readonly ManagedRichTextInline[];
    readonly expected: unknown;
  }[] = [
    {
      name: "unmarked text is bare text",
      inlines: [text("plain")],
      expected: [{ kind: "text", text: "plain" }],
    },
    {
      name: "a run sharing its outer mark nests inside one element",
      inlines: [text("Some "), text("bold ", bold), text("and italic", bold, italic), text(" text")],
      expected: [
        { kind: "text", text: "Some " },
        {
          kind: "mark",
          mark: bold,
          children: [
            { kind: "text", text: "bold " },
            { kind: "mark", mark: italic, children: [{ kind: "text", text: "and italic" }] },
          ],
        },
        { kind: "text", text: " text" },
      ],
    },
    {
      name: "mark order is nesting order",
      inlines: [text("x", italic, bold)],
      expected: [
        {
          kind: "mark",
          mark: italic,
          children: [{ kind: "mark", mark: bold, children: [{ kind: "text", text: "x" }] }],
        },
      ],
    },
    {
      name: "two links to different places stay two elements",
      inlines: [text("a", link("https://example.com/a")), text("b", link("https://example.com/b"))],
      expected: [
        { kind: "mark", mark: link("https://example.com/a"), children: [{ kind: "text", text: "a" }] },
        { kind: "mark", mark: link("https://example.com/b"), children: [{ kind: "text", text: "b" }] },
      ],
    },
    {
      name: "an inner mark that changes does not split the outer one",
      inlines: [text("a", bold, italic), text("b", bold)],
      expected: [
        {
          kind: "mark",
          mark: bold,
          children: [
            { kind: "mark", mark: italic, children: [{ kind: "text", text: "a" }] },
            { kind: "text", text: "b" },
          ],
        },
      ],
    },
  ];
  for (const testCase of cases) {
    it(testCase.name, () => {
      assert.deepEqual(groupManagedRichTextInlines(testCase.inlines), testCase.expected);
    });
  }
});

describe("managedRichTextBlockInlines", () => {
  const paragraph = { type: "paragraph", content: [text("one")] } as const;
  const heading = { type: "heading", attrs: { level: 2 }, content: [text("two")] } as const;

  it("reads the one paragraph or heading a block field holds", () => {
    assert.deepEqual(managedRichTextBlockInlines({ type: "doc", content: [paragraph] }), [text("one")]);
    assert.deepEqual(managedRichTextBlockInlines({ type: "doc", content: [heading] }), [text("two")]);
  });

  const refused: readonly { readonly name: string; readonly document: ManagedRichTextDocument }[] = [
    { name: "two blocks", document: { type: "doc", content: [paragraph, paragraph] } },
    {
      name: "a list",
      document: {
        type: "doc",
        content: [{ type: "bullet_list", content: [{ type: "list_item", content: [paragraph] }] }],
      },
    },
    { name: "a quotation", document: { type: "doc", content: [{ type: "blockquote", content: [paragraph] }] } },
  ];
  for (const testCase of refused) {
    it(`refuses ${testCase.name} rather than rendering part of it`, () => {
      assert.throws(
        () => managedRichTextBlockInlines(testCase.document),
        (error: unknown) =>
          error instanceof ManagedSiteContractError && error.code === "RICH_TEXT_NOT_ONE_BLOCK",
      );
    });
  }
});

describe("rich text mark annotations", () => {
  it("names each mark kind on the element that renders it", () => {
    assert.equal(MANAGED_RICH_TEXT_MARK_ATTRIBUTE, "data-gomega-mark");
    for (const kind of ["bold", "italic", "link"] as const) {
      assert.deepEqual(managedRichTextMarkAttributesV1(kind), { "data-gomega-mark": kind });
    }
  });

  const links: readonly {
    readonly name: string;
    readonly mark: ManagedRichTextMark & { type: "link" };
    readonly expected: unknown;
  }[] = [
    {
      name: "an external link is its URL",
      mark: { type: "link", destination: { kind: "external", url: "https://example.com/a?b=c" }, target: "same_window" },
      expected: { href: "https://example.com/a?b=c", target: undefined },
    },
    {
      name: "a new window is _blank",
      mark: { type: "link", destination: { kind: "external", url: "https://example.com/" }, target: "new_window" },
      expected: { href: "https://example.com/", target: "_blank" },
    },
    {
      name: "an email address is a mailto link",
      mark: { type: "link", destination: { kind: "email", address: "hello@example.com" }, target: "same_window" },
      expected: { href: "mailto:hello@example.com", target: undefined },
    },
    {
      name: "a phone number is a tel link",
      mark: { type: "link", destination: { kind: "phone", number: "+15555550100" }, target: "same_window" },
      expected: { href: "tel:+15555550100", target: undefined },
    },
  ];
  for (const testCase of links) {
    it(testCase.name, () => {
      assert.deepEqual(managedRichTextLinkAttributesV1(testCase.mark), testCase.expected);
    });
  }

  it("refuses an internal link, whose path this package cannot know", () => {
    assert.throws(
      () =>
        managedRichTextLinkAttributesV1({
          type: "link",
          destination: { kind: "internal", pageId: stableId("page"), fragment: null },
          target: "same_window",
        }),
      (error: unknown) =>
        error instanceof ManagedSiteContractError && error.code === "RICH_TEXT_LINK_UNRESOLVED",
    );
  });
});

/**
 * Levels 1 to 3 are a heading block; anything else is refused, whatever its
 * spelling. Level 1 is admitted so a converted page title (an `h1` with a
 * styled span) can be one heading field.
 */
describe("heading levels", () => {
  it("are the levels the heading block schema admits", () => {
    assert.deepEqual(MANAGED_RICH_TEXT_HEADING_LEVELS, [1, 2, 3]);
  });

  const heading = (level: unknown): unknown => ({
    type: "doc",
    content: [{ type: "heading", attrs: { level }, content: [{ type: "text", text: "Title" }] }],
  });
  for (const level of [1, 2, 3]) {
    it(`admits level ${String(level)}`, () => {
      assert.doesNotThrow(() => parseManagedRichTextDocument(heading(level)));
    });
  }
  for (const level of [0, 4, 5, 6, -1, 1.5, 2.5, "1", null, true, [1]]) {
    it(`refuses level ${JSON.stringify(level)}`, () => {
      assert.throws(() => parseManagedRichTextDocument(heading(level)));
    });
  }
});

/**
 * `maxBlocks` bounds how many top-level blocks a document may hold. A field
 * rendered inside one site element (a heading, a paragraph, a button) holds
 * exactly one block: a second paragraph has nowhere to render.
 */
describe("maxBlocks", () => {
  const paragraph = { type: "paragraph", content: [{ type: "text", text: "one" }] };
  const fieldWith = (maxBlocks: unknown): Record<string, unknown> => {
    const base = richTextField();
    const constraints = { ...(base.constraints as Record<string, unknown>) };
    if (maxBlocks !== undefined) constraints.maxBlocks = maxBlocks;
    return { ...base, constraints };
  };
  const validate = (field: Record<string, unknown>, blocks: number): void => {
    validateManagedFieldValue(field, {
      fieldId: stableId("field"),
      owner: { kind: "site" },
      type: "rich_text",
      value: { type: "doc", content: Array.from({ length: blocks }, () => paragraph) },
    });
  };

  it("admits documents up to the bound", () => {
    validate(fieldWith(1), 1);
    validate(fieldWith(2), 2);
  });

  it("refuses a document past the bound", () => {
    assert.throws(() => validate(fieldWith(1), 2));
  });

  it("is unbounded when absent, as every field was before it existed", () => {
    validate(fieldWith(undefined), 5);
  });

  for (const invalid of [0, -1, 1.5, "1", null]) {
    it(`refuses ${JSON.stringify(invalid)} as a bound`, () => {
      assert.throws(() => parseManagedFieldDescriptor(fieldWith(invalid)));
    });
  }

  it("parses standalone like every other rich-text constraint", () => {
    const constraints = {
      ...((richTextField().constraints as Record<string, unknown>)),
      maxBlocks: 1,
    };
    assert.equal(parseManagedRichTextConstraints(constraints).maxBlocks, 1);
  });
});

describe("internal rich-text links with a site's page paths", () => {
  it("resolve through the resolver, fragment included", () => {
    const pageId = stableId("page");
    const paths = new Map([[pageId, "/about"]]);
    const resolve = (id: string): string => paths.get(id as typeof pageId) ?? "";
    assert.deepEqual(
      managedRichTextLinkAttributesV1(
        { type: "link", destination: { kind: "internal", pageId, fragment: null }, target: "same_window" },
        resolve,
      ),
      { href: "/about", target: undefined },
    );
    assert.deepEqual(
      managedRichTextLinkAttributesV1(
        { type: "link", destination: { kind: "internal", pageId, fragment: "team" }, target: "new_window" },
        resolve,
      ),
      { href: "/about#team", target: "_blank" },
    );
  });
});
