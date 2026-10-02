import { randomBytes } from "node:crypto";

import { ManagedSiteContractError } from "./errors.js";

export const STABLE_ID_KINDS = Object.freeze([
  "contract",
  "page",
  "section",
  "field",
  "collection",
  "item",
  "asset",
  "alias",
] as const);

export type StableIdKind = (typeof STABLE_ID_KINDS)[number];
export type StableId<Kind extends StableIdKind = StableIdKind> = string & {
  readonly __stableIdKind: Kind;
};

const STABLE_ID_KIND_SET = new Set<string>(STABLE_ID_KINDS);
const STABLE_ID_PATTERN = /^([a-z]+)_([0-9a-hjkmnp-tv-z]{25}[048cgmrw])$/;
const CROCKFORD_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";
const ENTROPY_BYTES = 16;
const ENCODED_LENGTH = 26;

function fail(code: string, message: string): never {
  throw new ManagedSiteContractError(code, message);
}

function assertKind(value: string): asserts value is StableIdKind {
  if (!STABLE_ID_KIND_SET.has(value)) {
    return fail("STABLE_ID_KIND_INVALID", `Unknown stable ID kind: ${value}`);
  }
}

function encodeEntropy(entropy: Uint8Array): string {
  let buffer = 0;
  let bits = 0;
  let encoded = "";
  for (const byte of entropy) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      encoded += CROCKFORD_ALPHABET[(buffer >> bits) & 31];
      buffer &= (1 << bits) - 1;
    }
  }
  if (bits > 0) {
    encoded += CROCKFORD_ALPHABET[(buffer << (5 - bits)) & 31];
  }
  if (encoded.length !== ENCODED_LENGTH) {
    return fail("STABLE_ID_ENCODING", "Stable ID entropy could not be encoded");
  }
  return encoded;
}

function parseParts(value: string): readonly [StableIdKind, string] {
  const match = STABLE_ID_PATTERN.exec(value);
  if (match === null) {
    return fail("STABLE_ID_INVALID", "Stable ID does not match the required format");
  }
  const [, rawKind, suffix] = match;
  if (!STABLE_ID_KIND_SET.has(rawKind)) {
    return fail("STABLE_ID_INVALID", "Stable ID contains an unknown kind");
  }
  return [rawKind as StableIdKind, suffix];
}

export function mintStableId<Kind extends StableIdKind>(
  kind: Kind,
  suppliedEntropy?: Uint8Array,
): StableId<Kind> {
  assertKind(kind);
  const entropy = suppliedEntropy ?? randomBytes(ENTROPY_BYTES);
  if (entropy.byteLength !== ENTROPY_BYTES) {
    return fail(
      "STABLE_ID_ENTROPY_LENGTH",
      `Stable IDs require exactly ${ENTROPY_BYTES} bytes of entropy`,
    );
  }
  return `${kind}_${encodeEntropy(entropy)}` as StableId<Kind>;
}

export function parseStableId(value: string): StableId;
export function parseStableId<Kind extends StableIdKind>(
  value: string,
  expectedKind: Kind,
): StableId<Kind>;
export function parseStableId<Kind extends StableIdKind>(
  value: string,
  expectedKind?: Kind,
): StableId<Kind> {
  const [kind] = parseParts(value);
  if (expectedKind !== undefined) {
    assertKind(expectedKind);
  }
  if (expectedKind !== undefined && kind !== expectedKind) {
    return fail(
      "STABLE_ID_KIND_MISMATCH",
      `Expected a ${expectedKind} ID but received ${kind}`,
    );
  }
  return value as StableId<Kind>;
}

export function getStableIdKind(value: string): StableIdKind {
  return parseParts(value)[0];
}

function registerStableId(
  id: StableId,
  exact: Set<string>,
  suffixes: Map<string, StableIdKind>,
): void {
  const [kind, suffix] = parseParts(id);
  if (exact.has(id)) {
    return fail("STABLE_ID_DUPLICATE", `Duplicate stable ID: ${id}`);
  }
  const existingKind = suffixes.get(suffix);
  if (existingKind !== undefined && existingKind !== kind) {
    return fail(
      "STABLE_ID_CROSS_KIND_COLLISION",
      "Stable ID entropy cannot be reused across kinds",
    );
  }
  exact.add(id);
  suffixes.set(suffix, kind);
}

export function assertDistinctStableIds(
  values: readonly string[],
): readonly StableId[] {
  const ids = values.map((value) => parseStableId(value));
  const exact = new Set<string>();
  const suffixes = new Map<string, StableIdKind>();
  for (const id of ids) {
    registerStableId(id, exact, suffixes);
  }
  return Object.freeze(ids);
}
