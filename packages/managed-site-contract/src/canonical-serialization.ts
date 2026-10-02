import type { JsonValue } from "./json.js";

function serializeArray(value: readonly JsonValue[]): string {
  return `[${value.map((item) => serializeJcsJson(item)).join(",")}]`;
}

function serializeObject(value: Readonly<Record<string, JsonValue>>): string {
  const properties = Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${serializeJcsJson(value[key])}`);
  return `{${properties.join(",")}}`;
}

export function serializeJcsJson(value: JsonValue): string {
  if (value === null || typeof value === "boolean") {
    return String(value);
  }
  if (typeof value === "number") {
    return Object.is(value, -0) ? "0" : JSON.stringify(value);
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return serializeArray(value);
  }
  return serializeObject(value as Readonly<Record<string, JsonValue>>);
}
