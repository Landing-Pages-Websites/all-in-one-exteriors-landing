import type { JsonValue } from "@landing-pages-websites/managed-site-contract";

/** Mutable JSON object under construction, before it is frozen into a document. */
export type JsonObject = Record<string, JsonValue>;

export function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decodeToken(token: string): string {
  return token.replaceAll("~1", "/").replaceAll("~0", "~");
}

/**
 * Writes a value at a JSON pointer, creating intermediate objects. Used to
 * build the proposed source documents so their shape matches the resolvers the
 * contract declares — one derivation, not two.
 */
/** Source documents own their copy; content values must never be aliased into them. */
export function cloneJson(value: JsonValue): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

export function writeAtPointer(root: JsonObject, pointer: string, value: JsonValue): void {
  const tokens = pointer.split("/").slice(1).map(decodeToken);
  const last = tokens.pop();
  if (last === undefined) return;
  let cursor = root;
  for (const token of tokens) {
    const next = cursor[token];
    if (isJsonObject(next)) {
      cursor = next;
      continue;
    }
    const created: JsonObject = {};
    cursor[token] = created;
    cursor = created;
  }
  cursor[last] = value;
}
