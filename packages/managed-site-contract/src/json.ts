import { types } from "node:util";

import { ManagedSiteContractError } from "./errors.js";
import {
  HARD_MAX_JSON_DEPTH,
  HARD_MAX_JSON_NODES,
  resolveJsonParseLimits,
  type JsonParseLimits,
} from "./json-limits.js";

export { ManagedSiteContractError };
export { HARD_MAX_JSON_DEPTH, HARD_MAX_JSON_NODES };
export type { JsonParseLimits };

export type JsonPrimitive = null | boolean | number | string;
export type JsonValue =
  | JsonPrimitive
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

const ARRAY_INDEX_PATTERN = /^(0|[1-9]\d*)$/;

interface ParseContext {
  readonly maxDepth: number;
  readonly maxNodes: number;
  readonly ancestors: WeakSet<object>;
  nodes: number;
}

function fail(code: string, message: string): never {
  throw new ManagedSiteContractError(code, message);
}

function isHighSurrogate(unit: number): boolean {
  return unit >= 0xd800 && unit <= 0xdbff;
}

function isLowSurrogate(unit: number): boolean {
  return unit >= 0xdc00 && unit <= 0xdfff;
}

function nextUnicodeIndex(value: string, index: number, code: string): number {
  const unit = value.charCodeAt(index);
  if (isLowSurrogate(unit)) {
    return fail(code, "Text contains an unpaired low surrogate");
  }
  if (!isHighSurrogate(unit)) {
    return index + 1;
  }
  const next = value.charCodeAt(index + 1);
  if (index + 1 >= value.length || !isLowSurrogate(next)) {
    return fail(code, "Text contains an unpaired high surrogate");
  }
  return index + 2;
}

function assertValidUnicode(value: string, code: string): void {
  let index = 0;
  while (index < value.length) {
    index = nextUnicodeIndex(value, index, code);
  }
}

function parseString(value: string, notNfcCode: string): string {
  assertValidUnicode(value, "JSON_INVALID_UNICODE");
  if (value.normalize("NFC") !== value) {
    return fail(notNfcCode, "Text must use Unicode NFC normalization");
  }
  return value;
}

function countNode(context: ParseContext, depth: number): void {
  if (depth > context.maxDepth) {
    return fail("JSON_MAX_DEPTH", "JSON exceeds the configured depth limit");
  }
  context.nodes += 1;
  if (context.nodes > context.maxNodes) {
    return fail("JSON_MAX_NODES", "JSON exceeds the configured node limit");
  }
}

function withAncestor<T>(
  value: object,
  context: ParseContext,
  action: () => T,
): T {
  if (context.ancestors.has(value)) {
    return fail("JSON_CYCLE", "JSON values cannot contain cycles");
  }
  context.ancestors.add(value);
  try {
    return action();
  } finally {
    context.ancestors.delete(value);
  }
}

function assertNoSymbolKeys(value: object): void {
  if (Object.getOwnPropertySymbols(value).length > 0) {
    return fail("JSON_SYMBOL_KEY", "JSON values cannot contain symbol keys");
  }
}

function readDataProperty(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor === undefined) {
    return fail("JSON_PROPERTY_MISSING", "JSON property disappeared during parsing");
  }
  if (descriptor.get !== undefined || descriptor.set !== undefined) {
    return fail("JSON_ACCESSOR", "JSON values cannot contain accessors");
  }
  if (!descriptor.enumerable) {
    return fail("JSON_NON_ENUMERABLE_KEY", "JSON keys must be enumerable");
  }
  return descriptor.value;
}

function parseArray(
  value: readonly unknown[],
  context: ParseContext,
  depth: number,
): readonly JsonValue[] {
  if (Object.getPrototypeOf(value) !== Array.prototype) {
    return fail("JSON_NON_PLAIN_ARRAY", "JSON arrays must be plain arrays");
  }
  assertNoSymbolKeys(value);
  const keys = Object.getOwnPropertyNames(value).filter((key) => key !== "length");
  const hasInvalidKey = keys.some(
    (key) => !ARRAY_INDEX_PATTERN.test(key) || Number(key) >= value.length,
  );
  if (hasInvalidKey) {
    return fail("JSON_ARRAY_PROPERTY", "JSON arrays cannot contain named properties");
  }
  return withAncestor(value, context, () => parseArrayItems(value, context, depth));
}

function parseArrayItems(
  value: readonly unknown[],
  context: ParseContext,
  depth: number,
): readonly JsonValue[] {
  const result: JsonValue[] = [];
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) {
      return fail("JSON_SPARSE_ARRAY", "JSON arrays cannot contain holes");
    }
    result.push(parseValue(readDataProperty(value, String(index)), context, depth + 1));
  }
  return Object.freeze(result);
}

function registerNormalizedKey(key: string, normalizedKeys: Set<string>): void {
  assertValidUnicode(key, "JSON_INVALID_UNICODE");
  const normalized = key.normalize("NFC");
  if (normalizedKeys.has(normalized)) {
    return fail(
      "JSON_KEY_NORMALIZATION_COLLISION",
      "Object keys collide after Unicode normalization",
    );
  }
  normalizedKeys.add(normalized);
}

function assertNormalizedKeys(keys: readonly string[]): void {
  const normalizedKeys = new Set<string>();
  for (const key of keys) {
    registerNormalizedKey(key, normalizedKeys);
  }
  for (const key of keys) {
    parseString(key, "JSON_KEY_NOT_NFC");
  }
}

function defineParsedProperty(
  result: Record<string, JsonValue>,
  key: string,
  value: JsonValue,
): void {
  Object.defineProperty(result, key, {
    configurable: false,
    enumerable: true,
    value,
    writable: false,
  });
}

function parseObjectEntries(
  value: object,
  keys: readonly string[],
  context: ParseContext,
  depth: number,
): Readonly<Record<string, JsonValue>> {
  const result: Record<string, JsonValue> = {};
  for (const key of keys) {
    const parsed = parseValue(readDataProperty(value, key), context, depth + 1);
    defineParsedProperty(result, key, parsed);
  }
  return Object.freeze(result);
}

function parseObject(
  value: object,
  context: ParseContext,
  depth: number,
): Readonly<Record<string, JsonValue>> {
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return fail("JSON_NON_PLAIN_OBJECT", "JSON objects must be plain objects");
  }
  assertNoSymbolKeys(value);
  const keys = Object.getOwnPropertyNames(value);
  assertNormalizedKeys(keys);
  return withAncestor(value, context, () =>
    parseObjectEntries(value, keys, context, depth),
  );
}

function parseValue(value: unknown, context: ParseContext, depth: number): JsonValue {
  countNode(context, depth);
  if (value === null || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    return parseString(value, "JSON_STRING_NOT_NFC");
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return fail("JSON_NON_FINITE_NUMBER", "JSON numbers must be finite");
    }
    return value;
  }
  if (typeof value === "object") {
    if (types.isProxy(value)) {
      return fail("JSON_PROXY", "JSON values cannot contain Proxy objects");
    }
    if (Array.isArray(value)) {
      return parseArray(value, context, depth);
    }
    return parseObject(value, context, depth);
  }
  return fail("JSON_UNSUPPORTED_TYPE", `Unsupported JSON value type: ${typeof value}`);
}

/**
 * A mutable deep copy of a JSON value, built from this module's own realm so
 * the copy passes the plain-object check wherever the package runs.
 * `structuredClone` builds from the host realm, which a vm-isolated consumer
 * (Jest runs each suite in its own context) then refuses as non-plain.
 * `Object.fromEntries` defines keys rather than assigning them, so a
 * `__proto__` key stays a key. It applies no limits: pass only a value
 * `parseJsonValue` (or a parser built on it) already admitted.
 */
export function copyJsonValue<T extends JsonValue>(value: T): T;
export function copyJsonValue(value: JsonValue): JsonValue {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return Array.from(value as readonly JsonValue[], (entry) => copyJsonValue(entry));
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, copyJsonValue(entry)]),
  );
}

export function parseJsonValue(
  input: unknown,
  limits: JsonParseLimits = {},
): JsonValue {
  const resolvedLimits = resolveJsonParseLimits(limits);
  const context: ParseContext = {
    ancestors: new WeakSet<object>(),
    maxDepth: resolvedLimits.maxDepth,
    maxNodes: resolvedLimits.maxNodes,
    nodes: 0,
  };
  return parseValue(input, context, 0);
}
