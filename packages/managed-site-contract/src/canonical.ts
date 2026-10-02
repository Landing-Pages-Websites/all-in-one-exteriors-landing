import { serializeJcsJson } from "./canonical-serialization.js";
import { parseJsonValue } from "./json.js";

export function canonicalizeJson(input: unknown): string {
  return serializeJcsJson(parseJsonValue(input));
}
