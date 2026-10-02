import assert from "node:assert/strict";
import { describe, it } from "node:test";

import * as contractApi from "../src/index.js";
import { serializeJcsJson } from "../src/canonical-serialization.js";
import {
  ManagedSiteContractError,
  canonicalizeJson,
  digestCanonicalJson,
  parseJsonText,
  parseJsonValue,
  type JsonParseLimits,
  type JsonTextParseLimits,
  type JsonValue,
} from "../src/index.js";

function expectContractError(
  action: () => unknown,
  expectedCode: string,
): void {
  assert.throws(action, (error: unknown) => {
    assert.ok(error instanceof ManagedSiteContractError);
    assert.equal(error.code, expectedCode);
    return true;
  });
}

function createAccessorInput(onRead: () => void): object {
  return Object.defineProperty({}, "secret", {
    enumerable: true,
    get() {
      onRead();
      return "leaked";
    },
  });
}

function createTrappingProxy(target: object, onTrap: () => void): object {
  return new Proxy(target, {
    getOwnPropertyDescriptor() {
      onTrap();
      return undefined;
    },
    getPrototypeOf() {
      onTrap();
      return Object.prototype;
    },
    ownKeys() {
      onTrap();
      return [];
    },
  });
}

function createNestedArray(depth: number): unknown {
  let value: unknown = null;
  for (let index = 0; index < depth; index += 1) {
    value = [value];
  }
  return value;
}

function createNestedArrayText(depth: number): string {
  return `${"[".repeat(depth)}null${"]".repeat(depth)}`;
}

function expectHardCapErrors<T>(
  limits: readonly T[],
  action: (limit: T) => unknown,
): void {
  for (const limit of limits) {
    expectContractError(
      () => action(limit),
      "JSON_LIMIT_EXCEEDS_HARD_CAP",
    );
  }
}

const PUBLIC_JSON_ENTRYPOINTS: ReadonlyArray<
  readonly [string, (input: unknown) => unknown]
> = [
  ["parseJsonValue", parseJsonValue],
  ["canonicalizeJson", canonicalizeJson],
  ["digestCanonicalJson", digestCanonicalJson],
];

describe("canonical JSON", () => {
  it("sorts object keys by UTF-16 code units without depending on insertion order", () => {
    const first = {
      "€": "Euro Sign",
      "\r": "Carriage Return",
      "דּ": "Hebrew Letter Dalet With Dagesh",
      "1": "One",
      "😀": "Emoji: Grinning Face",
      "": "Control",
      "ö": "Latin Small Letter O With Diaeresis",
    };
    const second = Object.fromEntries(Object.entries(first).reverse());
    const expected =
      '{"\\r":"Carriage Return","1":"One","":"Control","ö":"Latin Small Letter O With Diaeresis","דּ":"Hebrew Letter Dalet With Dagesh","€":"Euro Sign","😀":"Emoji: Grinning Face"}';

    assert.equal(canonicalizeJson(first), expected);
    assert.equal(canonicalizeJson(second), expected);
  });

  it("matches the exact RFC 8785 property-order vector in the pure JCS layer", () => {
    const vector = {
      "€": "Euro Sign",
      "\r": "Carriage Return",
      "דּ": "Hebrew Letter Dalet With Dagesh",
      "1": "One",
      "😀": "Emoji: Grinning Face",
      "": "Control",
      "ö": "Latin Small Letter O With Diaeresis",
    };
    const expected =
      '{"\\r":"Carriage Return","1":"One","":"Control","ö":"Latin Small Letter O With Diaeresis","€":"Euro Sign","😀":"Emoji: Grinning Face","דּ":"Hebrew Letter Dalet With Dagesh"}';

    assert.equal(serializeJcsJson(vector), expected);
    expectContractError(() => canonicalizeJson(vector), "JSON_KEY_NOT_NFC");
  });

  it("uses ECMAScript number serialization required by RFC 8785", () => {
    assert.equal(
      canonicalizeJson([-0, 333333333.33333329, 1e30, 4.5, 2e-3, 1e-27]),
      "[0,333333333.3333333,1e+30,4.5,0.002,1e-27]",
    );
  });

  it("escapes control characters while preserving valid NFC Unicode", () => {
    assert.equal(
      canonicalizeJson({ value: "café\u000f\n\"\\/" }),
      '{"value":"café\\u000f\\n\\\"\\\\/"}',
    );
  });

  it("returns a detached deeply frozen JSON value", () => {
    const input = { nested: { value: "original" }, list: [1, 2] };
    const parsed = parseJsonValue(input);

    input.nested.value = "changed";
    input.list.push(3);

    assert.equal(canonicalizeJson(parsed),
      '{"list":[1,2],"nested":{"value":"original"}}');
    assert.ok(Object.isFrozen(parsed));
    assert.ok(Object.isFrozen((parsed as { nested: object }).nested));
  });

  it("never invokes accessors while rejecting them", () => {
    let reads = 0;
    const input = Object.defineProperty({}, "secret", {
      enumerable: true,
      get() {
        reads += 1;
        return "leaked";
      },
    });

    expectContractError(() => parseJsonValue(input), "JSON_ACCESSOR");
    assert.equal(reads, 0);
  });

  it("keeps every public JSON entrypoint behind the same accessor-safe gate", () => {
    for (const [name, entrypoint] of PUBLIC_JSON_ENTRYPOINTS) {
      let reads = 0;
      const input = createAccessorInput(() => {
        reads += 1;
      });

      expectContractError(() => entrypoint(input), "JSON_ACCESSOR");
      assert.equal(reads, 0, `${name} invoked an accessor`);
    }
    assert.equal(Reflect.has(contractApi, "serializeCanonicalJson"), false);
  });

  it("rejects object, array, and revoked proxies before invoking traps", () => {
    for (const [name, entrypoint] of PUBLIC_JSON_ENTRYPOINTS) {
      for (const target of [{}, []]) {
        let traps = 0;
        const proxy = createTrappingProxy(target, () => {
          traps += 1;
        });

        expectContractError(() => entrypoint(proxy), "JSON_PROXY");
        assert.equal(traps, 0, `${name} invoked a Proxy trap`);
      }

      const revocable = Proxy.revocable({}, {});
      revocable.revoke();
      expectContractError(() => entrypoint(revocable.proxy), "JSON_PROXY");
    }
  });

  it("rejects Array subclasses as class instances", () => {
    class ContractArray extends Array<unknown> {}

    for (const [, entrypoint] of PUBLIC_JSON_ENTRYPOINTS) {
      expectContractError(
        () => entrypoint(new ContractArray("value")),
        "JSON_NON_PLAIN_ARRAY",
      );
    }
  });

  it("rejects values that JSON.stringify would silently coerce or omit", () => {
    const cases: ReadonlyArray<readonly [unknown, string]> = [
      [undefined, "JSON_UNSUPPORTED_TYPE"],
      [() => "value", "JSON_UNSUPPORTED_TYPE"],
      [Symbol("value"), "JSON_UNSUPPORTED_TYPE"],
      [BigInt(1), "JSON_UNSUPPORTED_TYPE"],
      [Number.NaN, "JSON_NON_FINITE_NUMBER"],
      [Number.POSITIVE_INFINITY, "JSON_NON_FINITE_NUMBER"],
      [[1, , 3], "JSON_SPARSE_ARRAY"],
      [new Date("2026-01-01T00:00:00Z"), "JSON_NON_PLAIN_OBJECT"],
    ];

    for (const [value, code] of cases) {
      expectContractError(() => parseJsonValue(value), code);
    }
  });

  it("rejects symbol keys, non-enumerable keys, and cyclic objects", () => {
    const symbolKeyed = { value: true, [Symbol("hidden")]: true };
    const nonEnumerable = Object.defineProperty({}, "hidden", {
      enumerable: false,
      value: true,
    });
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;

    expectContractError(
      () => parseJsonValue(symbolKeyed),
      "JSON_SYMBOL_KEY",
    );
    expectContractError(
      () => parseJsonValue(nonEnumerable),
      "JSON_NON_ENUMERABLE_KEY",
    );
    expectContractError(() => parseJsonValue(cyclic), "JSON_CYCLE");

    const arrayWithHiddenProperty = [1];
    Object.defineProperty(arrayWithHiddenProperty, "4294967295", {
      value: true,
    });
    expectContractError(
      () => parseJsonValue(arrayWithHiddenProperty),
      "JSON_ARRAY_PROPERTY",
    );
  });

  it("rejects non-NFC text, normalized key collisions, and lone surrogates", () => {
    expectContractError(
      () => parseJsonValue("cafe\u0301"),
      "JSON_STRING_NOT_NFC",
    );
    expectContractError(
      () => parseJsonValue({ "é": 1, "e\u0301": 2 }),
      "JSON_KEY_NORMALIZATION_COLLISION",
    );
    expectContractError(
      () => parseJsonValue("\ud800"),
      "JSON_INVALID_UNICODE",
    );
  });

  it("enforces explicit depth and node bounds", () => {
    expectContractError(
      () => parseJsonValue({ a: { b: true } }, { maxDepth: 1 }),
      "JSON_MAX_DEPTH",
    );
    expectContractError(
      () => parseJsonValue([1, 2, 3], { maxNodes: 3 }),
      "JSON_MAX_NODES",
    );
  });

  it("only lets callers tighten hard object-parser limits", () => {
    const overLimitCases: readonly JsonParseLimits[] = [
      { maxDepth: 65 },
      { maxDepth: Number.MAX_SAFE_INTEGER },
      { maxNodes: 50_001 },
      { maxNodes: Number.MAX_SAFE_INTEGER },
    ];

    const input = createNestedArray(10_000);
    expectHardCapErrors(overLimitCases, (limits) =>
      parseJsonValue(input, limits));
  });

  it("creates a lowercase domain-separated SHA-256 digest", () => {
    const digest = digestCanonicalJson({ b: 2, a: 1 });

    assert.match(digest, /^[0-9a-f]{64}$/);
    assert.equal(
      digest,
      "a60bb731baee6822363a1d846909d687e673091e065016b705ca371008214f8b",
    );
    assert.equal(
      digest,
      digestCanonicalJson(Object.fromEntries([["a", 1], ["b", 2]])),
    );
    assert.notEqual(
      digest,
      digestCanonicalJson({ domain: "gomega.managed-site-contract.v2", a: 1, b: 2 }),
    );
  });
});

describe("JSON text parsing", () => {
  it("parses strict JSON into the same detached frozen value form", () => {
    const parsed = parseJsonText(
      '{"message":"hello\\nworld","values":[null,true,false,-0,1.5e2]}',
    );

    assert.equal(
      canonicalizeJson(parsed),
      '{"message":"hello\\nworld","values":[null,true,false,0,150]}',
    );
    assert.ok(Object.isFrozen(parsed));
    assert.ok(Object.isFrozen((parsed as { values: readonly unknown[] }).values));
  });

  it("parses every JSON string escape and number production", () => {
    const input =
      '{"emptyArray":[],"emptyObject":{},"escaped":"\\\"\\\\\\/\\b\\f\\n\\r\\t\\u20ac","numbers":[0,-0,-1,1.25,1e2,-2E-3]}';

    assert.equal(
      canonicalizeJson(parseJsonText(input)),
      '{"emptyArray":[],"emptyObject":{},"escaped":"\\\"\\\\/\\b\\f\\n\\r\\t€","numbers":[0,0,-1,1.25,100,-0.002]}',
    );
  });

  it("keeps prototype-shaped keys as inert own data properties", () => {
    const parsed = parseJsonText(
      '{"__proto__":{"polluted":true},"constructor":"safe","prototype":"safe"}',
    ) as Readonly<Record<string, unknown>>;

    assert.equal(Object.hasOwn(parsed, "__proto__"), true);
    assert.deepEqual(parsed.__proto__, { polluted: true });
    assert.equal(parsed.constructor, "safe");
    assert.equal(Object.hasOwn(Object.prototype, "polluted"), false);
  });

  it("rejects exact and NFC-equivalent duplicate keys at every depth", () => {
    const cases: ReadonlyArray<readonly [string, string]> = [
      ['{"key":1,"key":2}', "JSON_DUPLICATE_KEY"],
      ['{"key":1,"\\u006bey":2}', "JSON_DUPLICATE_KEY"],
      ['{"nested":{"key":1,"key":2}}', "JSON_DUPLICATE_KEY"],
      ['{"é":1,"e\\u0301":2}', "JSON_KEY_NORMALIZATION_COLLISION"],
      [
        '{"nested":{"é":1,"e\\u0301":2}}',
        "JSON_KEY_NORMALIZATION_COLLISION",
      ],
    ];

    for (const [input, code] of cases) {
      expectContractError(() => parseJsonText(input), code);
    }
  });

  it("rejects malformed or trailing JSON instead of partially parsing it", () => {
    const malformed = [
      "",
      "[1,]",
      '{"key":}',
      '{"key" 1}',
      "01",
      "-",
      "+1",
      ".1",
      "1.",
      "1e",
      "1e+",
      '"unterminated',
      '"\\u12xz"',
      '"raw\ncontrol"',
    ];

    for (const input of malformed) {
      expectContractError(() => parseJsonText(input), "JSON_TEXT_INVALID");
    }
    expectContractError(
      () => parseJsonText('{"key":1} trailing'),
      "JSON_TEXT_TRAILING",
    );
  });

  it("enforces text, depth, node, NFC, Unicode, and number bounds", () => {
    const cases: ReadonlyArray<
      readonly [string, JsonTextParseLimits | undefined, string]
    > = [
      ['"é"', { maxBytes: 3 }, "JSON_TEXT_MAX_BYTES"],
      ['{"a":{"b":true}}', { maxDepth: 1 }, "JSON_MAX_DEPTH"],
      ["[1,2,3]", { maxNodes: 3 }, "JSON_MAX_NODES"],
      ['"cafe\\u0301"', undefined, "JSON_STRING_NOT_NFC"],
      ['"\\ud800"', undefined, "JSON_INVALID_UNICODE"],
      ["1e400", undefined, "JSON_NON_FINITE_NUMBER"],
      ["null", { maxBytes: -1 }, "JSON_LIMIT_INVALID"],
      ["null", { maxDepth: 1.5 }, "JSON_LIMIT_INVALID"],
      ["null", { maxNodes: -1 }, "JSON_LIMIT_INVALID"],
    ];

    for (const [input, limits, code] of cases) {
      expectContractError(() => parseJsonText(input, limits), code);
    }
    expectContractError(
      () => (parseJsonText as (input: unknown) => JsonValue)(null),
      "JSON_TEXT_INVALID",
    );
  });

  it("only lets callers tighten hard text-parser limits", () => {
    const overLimitCases: readonly JsonTextParseLimits[] = [
      { maxBytes: 16 * 1_024 * 1_024 + 1 },
      { maxBytes: Number.MAX_SAFE_INTEGER },
      { maxDepth: 65 },
      { maxDepth: Number.MAX_SAFE_INTEGER },
      { maxNodes: 50_001 },
      { maxNodes: Number.MAX_SAFE_INTEGER },
    ];

    const input = createNestedArrayText(10_000);
    expectHardCapErrors(overLimitCases, (limits) =>
      parseJsonText(input, limits));
  });
});
