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

/**
 * F's hard-break join: a part declared `joinedBy: "hard_break"` has one
 * `hard_break` node before it, and nothing else ever becomes one.
 */
const A = mintStableId("field");
const B = mintStableId("field");
const C = mintStableId("field");
const TARGET = mintStableId("field");
const ITALIC = { type: "italic" } as const;
const BOLD = { type: "bold" } as const;
const BREAK = { type: "hard_break" } as const;
const PARAGRAPH = { type: "rich_text", block: { type: "paragraph" } };
const H1 = { type: "rich_text", block: { type: "heading", level: 1 } };

function text(fieldId: string, value: string): ManagedSiteContentValue {
  return parseManagedSiteContentValue({ fieldId, owner: { kind: "site" }, type: "plain_text", value });
}

function sources(...values: ManagedSiteContentValue[]): ReadonlyMap<string, ManagedSiteContentValue> {
  return new Map(values.map((value) => [value.fieldId, value]));
}

function declare(into: unknown, parts: readonly unknown[]): unknown {
  return {
    schemaVersion: "1.0",
    from: { contractSha256: "a".repeat(64), contentSha256: "b".repeat(64) },
    steps: [{ op: "merge", target: TARGET, into, parts }],
  };
}

function step(into: unknown, parts: readonly unknown[]): ManagedSiteFieldMigrationStepV1 {
  return parseManagedSiteFieldMigrationV1(declare(into, parts)).steps[0];
}

function codeOf(action: () => unknown): string | undefined {
  try {
    action();
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

function target(content: readonly unknown[], block: unknown = { type: "paragraph" }): ManagedSiteContentValue {
  return parseManagedSiteContentValue({
    fieldId: TARGET,
    owner: { kind: "site" },
    type: "rich_text",
    value: { type: "doc", content: [{ ...(block as object), content }] },
  });
}

const BREAK_B = { source: B, joinedBy: "hard_break" } as const;

describe("F writes a hard break only where a part is declared joined by one", () => {
  const cases: readonly {
    readonly name: string;
    readonly into: unknown;
    readonly parts: readonly unknown[];
    readonly values: readonly ManagedSiteContentValue[];
    readonly content: readonly unknown[];
    readonly offsets: readonly (readonly [number, number])[];
  }[] = [
    {
      name: "one break between two parts",
      into: PARAGRAPH,
      parts: [{ source: A }, BREAK_B],
      values: [text(A, "Reach and"), text(B, "Activate")],
      content: [{ type: "text", text: "Reach and" }, BREAK, { type: "text", text: "Activate" }],
      offsets: [[0, 9], [9, 17]],
    },
    {
      name: "a line of several parts (a literal space, an italic source)",
      into: PARAGRAPH,
      parts: [{ source: A }, BREAK_B, { literal: " " }, { source: C, marks: [ITALIC] }],
      values: [text(A, "Reach and"), text(B, "Activate"), text(C, "Real-World")],
      content: [
        { type: "text", text: "Reach and" }, BREAK,
        { type: "text", text: "Activate " }, { type: "text", text: "Real-World", marks: [ITALIC] },
      ],
      offsets: [[0, 9], [9, 17], [17, 18], [18, 28]],
    },
    {
      name: "marks that would join across the break stay in separate runs",
      into: PARAGRAPH,
      parts: [{ source: A, marks: [ITALIC] }, { source: B, marks: [ITALIC], joinedBy: "hard_break" }],
      values: [text(A, "one"), text(B, "two")],
      content: [
        { type: "text", text: "one", marks: [ITALIC] }, BREAK, { type: "text", text: "two", marks: [ITALIC] },
      ],
      offsets: [[0, 3], [3, 6]],
    },
    {
      name: "a break in a heading at level 1, after a part that joins directly",
      into: H1,
      parts: [{ source: A }, { literal: " there" }, { source: B, joinedBy: "hard_break", marks: [BOLD] }],
      values: [text(A, "Hi"), text(B, "You")],
      content: [{ type: "text", text: "Hi there" }, BREAK, { type: "text", text: "You", marks: [BOLD] }],
      offsets: [[0, 2], [2, 8], [8, 11]],
    },
    {
      name: "two breaks",
      into: PARAGRAPH,
      parts: [{ source: A }, BREAK_B, { source: C, joinedBy: "hard_break" }],
      values: [text(A, "a"), text(B, "b"), text(C, "c")],
      content: [{ type: "text", text: "a" }, BREAK, { type: "text", text: "b" }, BREAK, { type: "text", text: "c" }],
      offsets: [[0, 1], [1, 2], [2, 3]],
    },
    {
      name: "an empty part inside a line, which drops out as it always did",
      into: PARAGRAPH,
      parts: [{ source: A }, BREAK_B, { source: C }],
      values: [text(A, "a"), text(B, "b"), text(C, "")],
      content: [{ type: "text", text: "a" }, BREAK, { type: "text", text: "b" }],
      offsets: [[0, 1], [1, 2], [2, 2]],
    },
  ];
  for (const { name, into, parts, values, content, offsets } of cases) {
    it(`writes ${name}`, () => {
      const merged = applyManagedSiteFieldMigrationStepV1(step(into, parts), sources(...values));
      const block = (into as { block: { type: string; level?: number } }).block;
      const expected = block.type === "heading"
        ? { type: "heading", attrs: { level: block.level }, content }
        : { type: "paragraph", content };
      assert.deepEqual(merged.value, { type: "doc", content: [expected] });
      assert.deepEqual(merged.offsets, offsets.map(([start, end]) => ({ start, end })));
    });
  }

  it("is deterministic, and a step with no join writes no break", () => {
    const joined = step(PARAGRAPH, [{ source: A }, BREAK_B]);
    const values = sources(text(A, "a"), text(B, "b"));
    assert.equal(
      canonicalizeJson(applyManagedSiteFieldMigrationStepV1(joined, values)),
      canonicalizeJson(applyManagedSiteFieldMigrationStepV1(joined, values)),
    );
    const plain = applyManagedSiteFieldMigrationStepV1(step(PARAGRAPH, [{ source: A }, { source: B }]), values);
    assert.deepEqual(plain.value, { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "ab" }] }] });
  });
});

describe("F refuses a hard break join it cannot write exactly", () => {
  const refusals: readonly [string, string, () => unknown][] = [
    ["a break before the first part (an edge)", "MIGRATION_DECLARATION_INVALID", () =>
      step(PARAGRAPH, [{ source: A, joinedBy: "hard_break" }, { source: B }])],
    ["a break declared on the only part", "MIGRATION_DECLARATION_INVALID", () =>
      step(PARAGRAPH, [{ source: A, joinedBy: "hard_break" }])],
    ["a break into plain text", "MIGRATION_DECLARATION_INVALID", () =>
      step({ type: "plain_text" }, [{ source: A }, BREAK_B])],
    ["a break between list items", "MIGRATION_DECLARATION_INVALID", () =>
      step({ type: "rich_text", block: { type: "bullet_list" } }, [{ source: A }, BREAK_B])],
    ["a join kind that is not a hard break", "MIGRATION_DECLARATION_INVALID", () =>
      step(PARAGRAPH, [{ source: A }, { source: B, joinedBy: "newline" }])],
    ["a join inferred as a boolean", "MIGRATION_DECLARATION_INVALID", () =>
      step(PARAGRAPH, [{ source: A }, { source: B, joinedBy: true }])],
    ["a step-level join", "MIGRATION_DECLARATION_INVALID", () =>
      parseManagedSiteFieldMigrationV1({
        ...(declare(PARAGRAPH, [{ source: A }, { source: B }]) as object),
        steps: [{ op: "merge", target: TARGET, into: PARAGRAPH, join: "hard_break", parts: [{ source: A }, { source: B }] }],
      })],
    ["an empty source after the break", "MIGRATION_HARD_BREAK_EMPTY_LINE", () =>
      applyManagedSiteFieldMigrationStepV1(step(PARAGRAPH, [{ source: A }, BREAK_B]), sources(text(A, "a"), text(B, "")))],
    ["an empty source before the break", "MIGRATION_HARD_BREAK_EMPTY_LINE", () =>
      applyManagedSiteFieldMigrationStepV1(step(PARAGRAPH, [{ source: A }, BREAK_B]), sources(text(A, ""), text(B, "b")))],
    ["a line of only empty parts between two breaks", "MIGRATION_HARD_BREAK_EMPTY_LINE", () =>
      applyManagedSiteFieldMigrationStepV1(
        step(PARAGRAPH, [{ source: A }, BREAK_B, { source: C, joinedBy: "hard_break" }]),
        sources(text(A, "a"), text(B, ""), text(C, "c")),
      )],
    ["a line of only spaces between two breaks", "MIGRATION_HARD_BREAK_EMPTY_LINE", () =>
      applyManagedSiteFieldMigrationStepV1(
        step(PARAGRAPH, [{ source: A }, { literal: " ", joinedBy: "hard_break" }, { source: B, joinedBy: "hard_break" }]),
        sources(text(A, "a"), text(B, "b")),
      )],
    ["a break joined through F called with a step the schema would refuse", "MIGRATION_DECLARATION_INVALID", () =>
      applyManagedSiteFieldMigrationStepV1(
        { op: "merge", target: TARGET, into: { type: "plain_text" }, parts: [{ source: A }, { source: B, joinedBy: "hard_break" }] },
        sources(text(A, "a"), text(B, "b")),
      )],
    ["a break between list items, through F called directly", "MIGRATION_DECLARATION_INVALID", () =>
      applyManagedSiteFieldMigrationStepV1(
        { op: "merge", target: TARGET, into: { type: "rich_text", block: { type: "bullet_list" } }, parts: [{ source: A }, { source: B, joinedBy: "hard_break" }] },
        sources(text(A, "a"), text(B, "b")),
      )],
    ["an empty part declared as the one a break joins", "MIGRATION_HARD_BREAK_EMPTY_LINE", () =>
      applyManagedSiteFieldMigrationStepV1(
        step(PARAGRAPH, [{ source: A }, BREAK_B, { source: C }]),
        sources(text(A, "a"), text(B, ""), text(C, "c")),
      )],
    ["a break whose preceding part is empty", "MIGRATION_HARD_BREAK_EMPTY_LINE", () =>
      applyManagedSiteFieldMigrationStepV1(
        step(PARAGRAPH, [{ source: A }, { source: B }, { source: C, joinedBy: "hard_break" }]),
        sources(text(A, "a"), text(B, ""), text(C, "c")),
      )],
    ["a part with a newline, which is never a break", "MIGRATION_TRANSFORM_DEFERRED", () =>
      applyManagedSiteFieldMigrationStepV1(step(PARAGRAPH, [{ source: A }, BREAK_B]), sources(text(A, "a\nb"), text(B, "c")))],
    ["a part with a tab or carriage return", "MIGRATION_TRANSFORM_DEFERRED", () =>
      applyManagedSiteFieldMigrationStepV1(step(PARAGRAPH, [{ source: A }, BREAK_B]), sources(text(A, "a"), text(B, "c\rd")))],
    ["a literal that is a newline beside a declared break", "MIGRATION_TRANSFORM_DEFERRED", () =>
      applyManagedSiteFieldMigrationStepV1(
        step(PARAGRAPH, [{ source: A }, { literal: "\n" }, BREAK_B]),
        sources(text(A, "a"), text(B, "b")),
      )],
    ["a source that already holds a break", "MIGRATION_TRANSFORM_DEFERRED", () =>
      applyManagedSiteFieldMigrationStepV1(
        step(PARAGRAPH, [{ source: A }, BREAK_B]),
        sources(
          parseManagedSiteContentValue({
            fieldId: A, owner: { kind: "site" }, type: "rich_text",
            value: { type: "doc", content: [{ type: "paragraph", content: [
              { type: "text", text: "x" }, BREAK, { type: "text", text: "y" },
            ] }] },
          }),
          text(B, "b"),
        ),
      )],
  ];
  for (const [name, code, action] of refusals) {
    it(`refuses ${name} with ${code}`, () => assert.equal(codeOf(action), code));
  }
});

describe("read-back of a hard break join", () => {
  const merge = step(PARAGRAPH, [{ source: A }, { literal: " " }, { source: B, joinedBy: "hard_break", marks: [ITALIC] }, { source: C, marks: [ITALIC] }]);
  const values = sources(text(A, "One"), text(B, "two"), text(C, "three"));
  const merged = applyManagedSiteFieldMigrationStepV1(merge, values);

  it("recovers each source's text and marks, the break sitting between parts", () => {
    const read = readBackManagedSiteFieldMigrationStepV1(
      target(((merged.value as { content: { content: unknown[] }[] }).content[0]).content),
      merge,
      merged.offsets,
    );
    assert.deepEqual(read, [
      { fieldId: A, text: "One", runs: [{ text: "One", marks: [] }] },
      { fieldId: B, text: "two", runs: [{ text: "two", marks: [] }] },
      { fieldId: C, text: "three", runs: [{ text: "three", marks: [] }] },
    ]);
  });

  const t = (text: string, marks?: unknown) => (marks === undefined ? { type: "text", text } : { type: "text", text, marks });
  const forged: readonly [string, readonly unknown[]][] = [
    ["the break moved into the first source", [t("On"), BREAK, t("e "), t("two", [ITALIC]), t("three", [ITALIC])]],
    ["the break moved to after the literal", [t("One"), BREAK, t(" "), t("two", [ITALIC]), t("three", [ITALIC])]],
    ["the break moved inside a source", [t("One "), t("tw", [ITALIC]), BREAK, t("o", [ITALIC]), t("three", [ITALIC])]],
    ["the break moved between the last two parts", [t("One "), t("two", [ITALIC]), BREAK, t("three", [ITALIC])]],
    ["the break dropped", [t("One "), t("twothree", [ITALIC])]],
    ["the break doubled", [t("One "), BREAK, t("two", [ITALIC]), BREAK, t("three", [ITALIC])]],
    ["the break at the wrong offset by a space", [t("One"), BREAK, t("two", [ITALIC]), t("three", [ITALIC])]],
  ];
  for (const [name, content] of forged) {
    it(`refuses ${name}`, () => {
      assert.equal(
        codeOf(() => readBackManagedSiteFieldMigrationStepV1(target(content), merge, merged.offsets)),
        "MIGRATION_READBACK_MISMATCH",
      );
    });
  }

  it("accepts the declared break and refuses it when the step declares none", () => {
    const honest = [t("One "), BREAK, t("two", [ITALIC]), t("three", [ITALIC])];
    assert.doesNotThrow(() => readBackManagedSiteFieldMigrationStepV1(target(honest), merge, merged.offsets));
    const noJoin = step(PARAGRAPH, [{ source: A }, { literal: " " }, { source: B, marks: [ITALIC] }, { source: C, marks: [ITALIC] }]);
    assert.equal(
      codeOf(() => readBackManagedSiteFieldMigrationStepV1(target(honest), noJoin, merged.offsets)),
      "MIGRATION_READBACK_MISMATCH",
    );
  });
});
