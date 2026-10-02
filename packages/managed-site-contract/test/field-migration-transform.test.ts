import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyManagedSiteFieldMigrationStepV1,
  canonicalizeJson,
  mintStableId,
  parseManagedSiteContentValue,
  parseManagedSiteFieldMigrationV1,
  readBackManagedSiteFieldMigrationStepV1,
  type ManagedSiteContentValue,
  type ManagedSiteFieldMigrationStepV1,
} from "../src/index.js";

const A = mintStableId("field");
const B = mintStableId("field");
const TARGET = mintStableId("field");
const ITALIC = { type: "italic" } as const;
const BOLD = { type: "bold" } as const;

function text(fieldId: string, value: string): ManagedSiteContentValue {
  return parseManagedSiteContentValue({ fieldId, owner: { kind: "site" }, type: "plain_text", value });
}

function rich(fieldId: string, content: readonly unknown[]): ManagedSiteContentValue {
  return parseManagedSiteContentValue({
    fieldId,
    owner: { kind: "site" },
    type: "rich_text",
    value: { type: "doc", content: [{ type: "paragraph", content }] },
  });
}

function headingSource(fieldId: string, level: 2 | 3): ManagedSiteContentValue {
  return parseManagedSiteContentValue({
    fieldId,
    owner: { kind: "site" },
    type: "rich_text",
    value: { type: "doc", content: [{ type: "heading", attrs: { level }, content: [{ type: "text", text: "Our Services" }] }] },
  });
}

function step(into: unknown, parts: readonly unknown[]): ManagedSiteFieldMigrationStepV1 {
  return parseManagedSiteFieldMigrationV1({
    schemaVersion: "1.0",
    from: { contractSha256: "a".repeat(64), contentSha256: "b".repeat(64) },
    steps: [{ op: "merge", target: TARGET, into, parts }],
  }).steps[0];
}

function sources(...values: ManagedSiteContentValue[]): ReadonlyMap<string, ManagedSiteContentValue> {
  return new Map(values.map((value) => [value.fieldId, value]));
}

function asTarget(type: "plain_text" | "rich_text", value: unknown): ManagedSiteContentValue {
  return parseManagedSiteContentValue({ fieldId: TARGET, owner: { kind: "site" }, type, value });
}

const PARAGRAPH = { type: "rich_text", block: { type: "paragraph" } };

function codeOf(action: () => unknown): string | undefined {
  try {
    action();
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

describe("F", () => {
  it("joins adjacent runs with identical marks and drops empty text", () => {
    const merged = applyManagedSiteFieldMigrationStepV1(
      step(PARAGRAPH, [{ source: A }, { literal: " " }, { source: B, marks: [ITALIC] }, { literal: "!", marks: [ITALIC] }]),
      sources(text(A, "Hello"), text(B, "world")),
    );
    assert.deepEqual(merged.value, {
      type: "doc",
      content: [{ type: "paragraph", content: [
        { type: "text", text: "Hello " },
        { type: "text", text: "world!", marks: [ITALIC] },
      ] }],
    });
    assert.deepEqual(merged.offsets, [
      { start: 0, end: 5 }, { start: 5, end: 6 }, { start: 6, end: 11 }, { start: 11, end: 12 },
    ]);
  });

  it("is deterministic", () => {
    const input = step(PARAGRAPH, [{ source: A, marks: [BOLD] }, { source: B }]);
    const values = sources(text(A, "a"), text(B, "b"));
    assert.equal(
      canonicalizeJson(applyManagedSiteFieldMigrationStepV1(input, values)),
      canonicalizeJson(applyManagedSiteFieldMigrationStepV1(input, values)),
    );
  });

  it("keeps a rich-text source's own marks inside the declared ones", () => {
    const merged = applyManagedSiteFieldMigrationStepV1(
      step(PARAGRAPH, [{ source: A, marks: [ITALIC] }]),
      sources(rich(A, [{ type: "text", text: "x" }, { type: "text", text: "y", marks: [BOLD] }])),
    );
    assert.deepEqual(merged.value, {
      type: "doc",
      content: [{ type: "paragraph", content: [
        { type: "text", text: "x", marks: [ITALIC] },
        { type: "text", text: "y", marks: [ITALIC, BOLD] },
      ] }],
    });
  });

  it("keeps a heading source at its own level", () => {
    const merged = applyManagedSiteFieldMigrationStepV1(
      step({ type: "rich_text", block: { type: "heading", level: 3 } }, [{ source: A }, { literal: ":" }]),
      sources(headingSource(A, 3)),
    );
    assert.deepEqual(merged.value, {
      type: "doc",
      content: [{ type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "Our Services:" }] }],
    });
  });

  it("writes a heading at the declared level and a list with one item per part", () => {
    const heading = applyManagedSiteFieldMigrationStepV1(
      step({ type: "rich_text", block: { type: "heading", level: 3 } }, [{ source: A }]),
      sources(text(A, "T")),
    );
    assert.deepEqual(heading.value, {
      type: "doc", content: [{ type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "T" }] }],
    });
    const list = applyManagedSiteFieldMigrationStepV1(
      step({ type: "rich_text", block: { type: "bullet_list" } }, [{ source: A }, { source: B }]),
      sources(text(A, "one"), text(B, "two")),
    );
    assert.deepEqual(list.value, {
      type: "doc",
      content: [{ type: "bullet_list", content: ["one", "two"].map((item) => ({
        type: "list_item", content: [{ type: "paragraph", content: [{ type: "text", text: item }] }],
      })) }],
    });
  });

  const refusals: readonly [string, string, () => unknown][] = [
    ["a rich-text source flattened into plain text", "MIGRATION_SOURCE_STRUCTURE_LOST", () =>
      applyManagedSiteFieldMigrationStepV1(
        step({ type: "plain_text" }, [{ source: A }]),
        sources(rich(A, [{ type: "text", text: "x", marks: [BOLD] }])),
      )],
    ["an unmarked rich-text source flattened into plain text", "MIGRATION_SOURCE_STRUCTURE_LOST", () =>
      applyManagedSiteFieldMigrationStepV1(
        step({ type: "plain_text" }, [{ source: A }]),
        sources(rich(A, [{ type: "text", text: "x" }])),
      )],
    ["a paragraph source made a heading", "MIGRATION_SOURCE_STRUCTURE_LOST", () =>
      applyManagedSiteFieldMigrationStepV1(
        step({ type: "rich_text", block: { type: "heading", level: 2 } }, [{ source: A }]),
        sources(rich(A, [{ type: "text", text: "x" }])),
      )],
    ["a paragraph source made a list item", "MIGRATION_SOURCE_STRUCTURE_LOST", () =>
      applyManagedSiteFieldMigrationStepV1(
        step({ type: "rich_text", block: { type: "bullet_list" } }, [{ source: A }]),
        sources(rich(A, [{ type: "text", text: "x" }])),
      )],
    ["a level-3 heading source made level 2", "MIGRATION_SOURCE_STRUCTURE_LOST", () =>
      applyManagedSiteFieldMigrationStepV1(
        step({ type: "rich_text", block: { type: "heading", level: 2 } }, [{ source: A }]),
        sources(headingSource(A, 3)),
      )],
    ["a heading source made a paragraph", "MIGRATION_SOURCE_STRUCTURE_LOST", () =>
      applyManagedSiteFieldMigrationStepV1(step(PARAGRAPH, [{ source: A }]), sources(headingSource(A, 3)))],
    ["a declared mark the source already has", "MIGRATION_MARK_CONFLICT", () =>
      applyManagedSiteFieldMigrationStepV1(
        step(PARAGRAPH, [{ source: A, marks: [BOLD] }]),
        sources(rich(A, [{ type: "text", text: "x", marks: [BOLD] }])),
      )],
    ["a merge of only empty text", "MIGRATION_TARGET_EMPTY", () =>
      applyManagedSiteFieldMigrationStepV1(step(PARAGRAPH, [{ source: A }]), sources(text(A, "")))],
    ["a source with no value", "MIGRATION_SOURCE_VALUE_MISSING", () =>
      applyManagedSiteFieldMigrationStepV1(step(PARAGRAPH, [{ source: A }]), sources())],
    ["a source of more than one block", "MIGRATION_TRANSFORM_DEFERRED", () =>
      applyManagedSiteFieldMigrationStepV1(
        step(PARAGRAPH, [{ source: A }]),
        new Map([[A, parseManagedSiteContentValue({
          fieldId: A, owner: { kind: "site" }, type: "rich_text",
          value: { type: "doc", content: [
            { type: "paragraph", content: [{ type: "text", text: "1" }] },
            { type: "paragraph", content: [{ type: "text", text: "2" }] },
          ] },
        })]]),
      )],
    ["a paragraph source holding a hard break", "MIGRATION_TRANSFORM_DEFERRED", () =>
      applyManagedSiteFieldMigrationStepV1(
        step(PARAGRAPH, [{ source: A }]),
        sources(rich(A, [{ type: "text", text: "Grow" }, { type: "hard_break" }, { type: "text", text: "more" }])),
      )],
    ["a heading source holding a hard break", "MIGRATION_TRANSFORM_DEFERRED", () =>
      applyManagedSiteFieldMigrationStepV1(
        step({ type: "rich_text", block: { type: "heading", level: 2 } }, [{ source: A }]),
        new Map([[A, parseManagedSiteContentValue({
          fieldId: A, owner: { kind: "site" }, type: "rich_text",
          value: { type: "doc", content: [{ type: "heading", attrs: { level: 2 }, content: [
            { type: "text", text: "Grow", marks: [BOLD] }, { type: "hard_break" }, { type: "text", text: "more", marks: [BOLD] },
          ] }] },
        })]]),
      )],
    ["a plain-text source holding a newline, into rich text", "MIGRATION_TRANSFORM_DEFERRED", () =>
      applyManagedSiteFieldMigrationStepV1(step(PARAGRAPH, [{ source: A }]), sources(text(A, "Line one\nLine two")))],
    ["a plain-text source holding a tab, into a heading", "MIGRATION_TRANSFORM_DEFERRED", () =>
      applyManagedSiteFieldMigrationStepV1(
        step({ type: "rich_text", block: { type: "heading", level: 2 } }, [{ source: A }]),
        sources(text(A, "Grow\tmore")),
      )],
    ["a literal holding a newline, into rich text", "MIGRATION_TRANSFORM_DEFERRED", () =>
      applyManagedSiteFieldMigrationStepV1(
        step(PARAGRAPH, [{ source: A }, { literal: "\n" }, { source: B }]),
        sources(text(A, "One"), text(B, "Two")),
      )],
    ["marks on a plain-text merge", "MIGRATION_DECLARATION_INVALID", () =>
      step({ type: "plain_text" }, [{ source: A, marks: [ITALIC] }])],
    ["a merge of literals only", "MIGRATION_DECLARATION_INVALID", () =>
      step(PARAGRAPH, [{ literal: "x" }])],
    ["an email link declared by code", "MIGRATION_DECLARATION_INVALID", () =>
      step(PARAGRAPH, [{ source: A, marks: [{ type: "link", destination: { kind: "email", address: "a@b.co" }, target: "same_window" }] }])],
    ["two italic marks on one part", "MIGRATION_DECLARATION_INVALID", () =>
      step(PARAGRAPH, [{ source: A, marks: [ITALIC, ITALIC] }])],
  ];
  for (const [name, code, action] of refusals) {
    it(`refuses ${name} with ${code}`, () => assert.equal(codeOf(action), code));
  }
});

it("still merges a newline into plain text, which may hold one", () => {
  const merged = applyManagedSiteFieldMigrationStepV1(
    step({ type: "plain_text" }, [{ source: A }, { literal: " " }, { source: B }]),
    sources(text(A, "Line one\nLine two"), text(B, "end")),
  );
  assert.equal(merged.value, "Line one\nLine two end");
});

describe("read-back", () => {
  const merge = step(PARAGRAPH, [{ source: A }, { literal: " " }, { source: B, marks: [ITALIC] }]);
  const values = sources(
    text(A, "Hello"),
    rich(B, [{ type: "text", text: "wor" }, { type: "text", text: "ld", marks: [BOLD] }]),
  );
  const merged = applyManagedSiteFieldMigrationStepV1(merge, values);

  it("recovers each source's text and its own marks", () => {
    const read = readBackManagedSiteFieldMigrationStepV1(asTarget("rich_text", merged.value), merge, merged.offsets);
    assert.deepEqual(read, [
      { fieldId: A, text: "Hello", runs: [{ text: "Hello", marks: [] }] },
      { fieldId: B, text: "world", runs: [{ text: "wor", marks: [] }, { text: "ld", marks: [BOLD] }] },
    ]);
  });

  function paragraph(content: readonly unknown[]): ManagedSiteContentValue {
    return asTarget("rich_text", { type: "doc", content: [{ type: "paragraph", content }] });
  }

  const forged: readonly [string, ManagedSiteContentValue][] = [
    ["a declared mark lost", paragraph([
      { type: "text", text: "Hello wor" }, { type: "text", text: "ld", marks: [BOLD] },
    ])],
    ["the separator changed", paragraph([
      { type: "text", text: "Hello " }, { type: "text", text: "wor", marks: [ITALIC] },
      { type: "text", text: "ld", marks: [ITALIC, BOLD] },
    ])],
    ["text added at the end", paragraph([
      { type: "text", text: "Hello " }, { type: "text", text: "wor", marks: [ITALIC] },
      { type: "text", text: "ld", marks: [ITALIC, BOLD] }, { type: "text", text: "." },
    ])],
    ["another block type", asTarget("rich_text", { type: "doc", content: [{ type: "heading", attrs: { level: 2 }, content: [
      { type: "text", text: "Hello " }, { type: "text", text: "wor", marks: [ITALIC] },
      { type: "text", text: "ld", marks: [ITALIC, BOLD] },
    ] }] })],
    ["plain text in place of rich text", asTarget("plain_text", "Hello world")],
    ["a hard break where the separator was", paragraph([
      { type: "text", text: "Hello" }, { type: "hard_break" }, { type: "text", text: "wor", marks: [ITALIC] },
      { type: "text", text: "ld", marks: [ITALIC, BOLD] },
    ])],
    ["a hard break inside a source's text", paragraph([
      { type: "text", text: "Hel" }, { type: "hard_break" }, { type: "text", text: "lo " },
      { type: "text", text: "wor", marks: [ITALIC] }, { type: "text", text: "ld", marks: [ITALIC, BOLD] },
    ])],
  ];
  for (const [name, target] of forged) {
    it(`refuses ${name}`, () => {
      assert.equal(
        codeOf(() => readBackManagedSiteFieldMigrationStepV1(target, merge, merged.offsets)),
        "MIGRATION_READBACK_MISMATCH",
      );
    });
  }

  it("reads a lost source mark back as lost, for the verifier to compare", () => {
    const target = paragraph([
      { type: "text", text: "Hello " }, { type: "text", text: "world", marks: [ITALIC] },
    ]);
    const read = readBackManagedSiteFieldMigrationStepV1(target, merge, merged.offsets);
    assert.deepEqual(read[1].runs, [{ text: "world", marks: [] }]);
  });

  it("refuses offsets that do not match the parts", () => {
    assert.equal(
      codeOf(() => readBackManagedSiteFieldMigrationStepV1(asTarget("rich_text", merged.value), merge, merged.offsets.slice(1))),
      "MIGRATION_READBACK_MISMATCH",
    );
  });
});
