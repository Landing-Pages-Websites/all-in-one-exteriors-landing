import type { JsonValue } from "./json.js";

export type JsonRecord = Readonly<Record<string, JsonValue>>;

export function isJsonRecord(value: JsonValue): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function hasExactJsonKeys(
  value: JsonRecord,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}
