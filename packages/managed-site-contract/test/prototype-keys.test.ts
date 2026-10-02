import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  parseJsonText,
  parseJsonValue,
  parseManagedFieldDescriptor,
  parseManagedRichTextDocument,
  parseManagedSiteContentValue,
  parseManagedSiteContractV1,
  type JsonValue,
} from "../src/index.js";
import {
  managedSiteContract,
  plainTextField,
  richTextDocument,
  stableId,
} from "./schema-fixtures.js";

const OBJECT_PROTOTYPE_KEYS = [
  "__proto__",
  "constructor",
  "prototype",
  "toString",
  "toLocaleString",
  "valueOf",
  "hasOwnProperty",
  "isPrototypeOf",
  "propertyIsEnumerable",
] as const;

type JsonBoundary = (input: unknown) => JsonValue;

const JSON_BOUNDARIES: ReadonlyArray<readonly [string, JsonBoundary]> = [
  ["parseJsonValue", parseJsonValue],
  ["parseJsonText", (input) => parseJsonText(JSON.stringify(input))],
];

interface StructuredCase {
  readonly name: string;
  readonly input: () => object;
  readonly path: readonly (string | number)[];
  readonly parse: (input: unknown) => unknown;
}

interface StructuredAttack {
  readonly name: string;
  readonly input: JsonValue;
  readonly parse: (input: unknown) => unknown;
}

function objectAtPath(input: object, path: readonly (string | number)[]): object {
  let current: unknown = input;
  for (const key of path) {
    assert.notEqual(current, null);
    assert.equal(typeof current, "object");
    current = (current as Record<string | number, unknown>)[key];
  }
  assert.notEqual(current, null);
  assert.equal(typeof current, "object");
  return current as object;
}

function addOwnKey(
  input: object,
  path: readonly (string | number)[],
  key: string,
): object {
  const clone = structuredClone(input);
  Object.defineProperty(objectAtPath(clone, path), key, {
    enumerable: true,
    value: `unexpected:${key}`,
  });
  return clone;
}

const STRUCTURED_CASES: readonly StructuredCase[] = [
  { name: "contract root", input: managedSiteContract, path: [], parse: parseManagedSiteContractV1 },
  { name: "field root", input: plainTextField, path: [], parse: parseManagedFieldDescriptor },
  {
    name: "nested presentation",
    input: plainTextField,
    path: ["presentation"],
    parse: parseManagedFieldDescriptor,
  },
  {
    name: "nested route union",
    input: managedSiteContract,
    path: ["pages", 0, "route"],
    parse: parseManagedSiteContractV1,
  },
  {
    name: "nested rich-text union",
    input: () => richTextDocument([
      { type: "paragraph", content: [{ type: "text", text: "copy" }] },
    ]),
    path: ["content", 0],
    parse: parseManagedRichTextDocument,
  },
];

function structuredAttacks(): readonly StructuredAttack[] {
  return JSON_BOUNDARIES.flatMap(([boundaryName, boundary]) =>
    STRUCTURED_CASES.flatMap((candidate) =>
      OBJECT_PROTOTYPE_KEYS.map((key) => ({
        name: `${boundaryName}:${candidate.name}:${key}`,
        input: boundary(addOwnKey(candidate.input(), candidate.path, key)),
        parse: candidate.parse,
      })),
    ),
  );
}

function opaquePrototypeObject(): Record<string, unknown> {
  const value: Record<string, unknown> = {};
  for (const key of OBJECT_PROTOTYPE_KEYS) {
    Object.defineProperty(value, key, {
      enumerable: true,
      value: `preserved:${key}`,
    });
  }
  return value;
}

function assertOpaqueKeysPreserved(input: unknown): void {
  assert.notEqual(input, null);
  assert.equal(typeof input, "object");
  assert.deepEqual(Object.keys(input as object).sort(), [...OBJECT_PROTOTYPE_KEYS].sort());
  for (const key of OBJECT_PROTOTYPE_KEYS) {
    assert.equal(Object.hasOwn(input as object, key), true, key);
    assert.equal(
      Object.getOwnPropertyDescriptor(input as object, key)?.value,
      `preserved:${key}`,
      key,
    );
  }
}

function nestedExample(depth: number): unknown {
  let value: unknown = "leaf";
  for (let level = 0; level < depth; level += 1) value = { nested: value };
  return value;
}

type NestedContainer = "array" | "object";

function opaqueExampleAtDepth(
  key: string,
  depth: number,
  container: NestedContainer,
): Record<string, unknown> {
  let value: unknown = "leaf";
  for (let level = 1; level < depth; level += 1) {
    value = container === "array" ? [value] : { nested: value };
  }
  const result: Record<string, unknown> = {};
  Object.defineProperty(result, key, { enumerable: true, value });
  return result;
}

function fieldWithExample(example: unknown): object {
  const field = plainTextField();
  field.presentation = { ...(field.presentation as object), example };
  return field;
}

describe("prototype-shaped JSON keys", () => {
  it("rejects every unknown own key at structured object depths", () => {
    for (const attack of structuredAttacks()) {
      assert.throws(() => attack.parse(attack.input), attack.name);
    }
  });

  it("preserves every valid own key in opaque presentation and internal JSON", () => {
    for (const [boundaryName, boundary] of JSON_BOUNDARIES) {
      const field = plainTextField();
      field.presentation = {
        ...(field.presentation as object),
        example: { nested: [opaquePrototypeObject()] },
      };
      const parsedField = parseManagedFieldDescriptor(boundary(field));
      const example = parsedField.presentation.example as {
        readonly nested: readonly unknown[];
      };
      assertOpaqueKeysPreserved(example.nested[0]);

      const content = {
        fieldId: stableId("field"),
        owner: { kind: "site" },
        type: "internal_protected",
        valueType: "json",
        value: [opaquePrototypeObject()],
      };
      const parsedContent = parseManagedSiteContentValue(boundary(content));
      assert.equal(parsedContent.type, "internal_protected", boundaryName);
      if (parsedContent.type === "internal_protected") {
        assert.ok(Array.isArray(parsedContent.value), boundaryName);
        assertOpaqueKeysPreserved(parsedContent.value[0]);
      }
    }
  });

  it("retains the presentation example depth bound", () => {
    const accepted = plainTextField();
    accepted.presentation = {
      ...(accepted.presentation as object),
      example: nestedExample(8),
    };
    assert.doesNotThrow(() => parseManagedFieldDescriptor(accepted));

    const rejected = plainTextField();
    rejected.presentation = {
      ...(rejected.presentation as object),
      example: nestedExample(9),
    };
    assert.throws(() => parseManagedFieldDescriptor(rejected));
  });

  it("enforces the depth bound beneath every opaque key and container topology", () => {
    for (const [boundaryName, boundary] of JSON_BOUNDARIES) {
      for (const key of OBJECT_PROTOTYPE_KEYS) {
        for (const container of ["object", "array"] as const) {
          const caseName = `${boundaryName}:${key}:${container}`;
          assert.doesNotThrow(
            () =>
              parseManagedFieldDescriptor(
                boundary(fieldWithExample(opaqueExampleAtDepth(key, 8, container))),
              ),
            `${caseName}:depth-8`,
          );
          assert.throws(
            () =>
              parseManagedFieldDescriptor(
                boundary(fieldWithExample(opaqueExampleAtDepth(key, 9, container))),
              ),
            `${caseName}:depth-9`,
          );
        }
      }
    }
  });

  it("accepts primitive leaves and mixed opaque topology at the exact bound", () => {
    for (const example of [null, true, false, 0, 1.5, "copy"] as const) {
      assert.doesNotThrow(() => parseManagedFieldDescriptor(fieldWithExample(example)));
    }

    const mixedAtDepthEight = {
      level2: [{ level4: [{ level6: [{ level8: ["leaf"] }] }] }],
    };
    assert.doesNotThrow(() =>
      parseManagedFieldDescriptor(fieldWithExample(mixedAtDepthEight)),
    );
    assert.throws(() =>
      parseManagedFieldDescriptor(
        fieldWithExample({ level1: mixedAtDepthEight }),
      ),
    );
  });

  it("keeps named properties invalid on arrays before schema validation", () => {
    for (const key of OBJECT_PROTOTYPE_KEYS) {
      const values: unknown[] = ["safe"];
      Object.defineProperty(values, key, { enumerable: true, value: "unexpected" });
      assert.throws(() => parseJsonValue(values), key);
    }
  });
});
