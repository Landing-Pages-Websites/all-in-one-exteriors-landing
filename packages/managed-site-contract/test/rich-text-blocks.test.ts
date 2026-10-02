import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  parseManagedFieldDescriptor,
  parseManagedRichTextDocument,
  validateManagedFieldValue,
} from "../src/index.js";
import { summarizeManagedRichText } from "../src/rich-text.js";
import { richTextField, stableId } from "./schema-fixtures.js";

/**
 * The heading and blockquote grammar, held to the same adversarial table the
 * CMS reader and writer in megaseo-web run. The file is byte-identical in both
 * repositories, so a verdict this package reaches differently from the CMS is a
 * case that fails in one of them rather than content the CMS saves and the site
 * then refuses to build.
 *
 * Only the outcome is compared here: this package reports its own error codes,
 * and the table's `reason` is the CMS writer's wording.
 */
interface GrammarCase {
  readonly name: string;
  readonly constraints?: Readonly<Record<string, unknown>>;
  readonly document: unknown;
  readonly expected: { readonly outcome: "accepted" | "rejected" };
}

interface GrammarTable {
  readonly baseConstraints: Readonly<Record<string, unknown>>;
  readonly cases: readonly GrammarCase[];
}

const TABLE = JSON.parse(
  readFileSync(new URL("./rich-text-block-grammar-cases.json", import.meta.url), "utf8"),
) as GrammarTable;

function fieldFor(grammarCase: GrammarCase): Record<string, unknown> {
  const constraints = { ...TABLE.baseConstraints, ...grammarCase.constraints };
  const base = richTextField();
  // A field whose policy disables links cannot also claim the capability to edit
  // them, so the capability follows the case's policy rather than the fixture's.
  const capabilities = (base.capabilities as readonly string[]).filter(
    (capability) => capability !== "rich_text.link.edit" || constraints.allowLinks === true,
  );
  return { ...base, capabilities, constraints };
}

function outcomeOf(grammarCase: GrammarCase): "accepted" | "rejected" {
  const field = fieldFor(grammarCase);
  // The table only states contracts this package accepts, so a field that fails
  // to parse is a broken case rather than a refused document.
  parseManagedFieldDescriptor(field);
  try {
    validateManagedFieldValue(field, {
      fieldId: stableId("field"),
      owner: { kind: "site" },
      type: "rich_text",
      value: grammarCase.document,
    });
    return "accepted";
  } catch {
    return "rejected";
  }
}

describe("rich-text headings and blockquotes", () => {
  it("runs a table that exercises both outcomes", () => {
    const outcomes = new Set(TABLE.cases.map((grammarCase) => grammarCase.expected.outcome));
    assert.deepEqual([...outcomes].sort(), ["accepted", "rejected"]);
  });

  for (const grammarCase of TABLE.cases) {
    it(`agrees on ${grammarCase.name}`, () => {
      assert.equal(outcomeOf(grammarCase), grammarCase.expected.outcome);
    });
  }

  /**
   * Size limits are enforced against this summary, so a block whose nodes or
   * text it skipped would slip past both limits, and a link inside it would slip
   * past the link policy that reads `textNodes`.
   */
  it("counts every node and every character inside the new blocks", () => {
    const document = parseManagedRichTextDocument({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Why" }] },
        {
          type: "blockquote",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "Fast" }] },
            { type: "paragraph", content: [{ type: "text", text: "Kind" }] },
          ],
        },
      ],
    });
    const summary = summarizeManagedRichText(document);
    // doc, heading, its text, blockquote, two paragraphs and their two texts.
    assert.equal(summary.nodes, 8);
    assert.equal(summary.characters, "WhyFastKind".length);
    assert.deepEqual(
      summary.textNodes.map((node) => node.text),
      ["Why", "Fast", "Kind"],
    );
  });

  it("refuses a contract that names a block outside the grammar", () => {
    const field = richTextField();
    const constraints = field.constraints as Record<string, unknown>;
    for (const block of ["heading_2", "quote", "list_item", "Heading"]) {
      assert.throws(() =>
        parseManagedFieldDescriptor({
          ...field,
          constraints: { ...constraints, allowedBlocks: ["paragraph", block] },
        }),
      );
    }
  });
});
