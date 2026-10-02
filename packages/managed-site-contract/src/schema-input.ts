import * as z from "zod";
import type { DeepReadonly } from "./deep-readonly.js";
import { ManagedSiteContractError } from "./errors.js";
import { parseJsonValue, type JsonValue } from "./json.js";

function failExactKeys(): never {
  throw new ManagedSiteContractError(
    "SCHEMA_EXACT_KEYS",
    "Schema validation must preserve every JSON object key",
  );
}

function assertExactJsonKeys(input: JsonValue, output: unknown): void {
  if (input === null || typeof input !== "object") return;
  if (output === null || typeof output !== "object") return failExactKeys();
  if (Array.isArray(input) !== Array.isArray(output)) return failExactKeys();

  const inputKeys = Object.keys(input);
  const outputKeys = Object.keys(output);
  if (inputKeys.length !== outputKeys.length) return failExactKeys();
  for (const key of inputKeys) {
    if (!Object.hasOwn(output, key)) return failExactKeys();
    const inputValue = (input as Readonly<Record<string, JsonValue>>)[key];
    const outputValue = (output as Readonly<Record<string, unknown>>)[key];
    assertExactJsonKeys(inputValue, outputValue);
  }
}

export function parseParsedSchemaInput<Schema extends z.ZodType>(
  schema: Schema,
  input: JsonValue,
): DeepReadonly<z.output<Schema>> {
  const validated = schema.parse(input);
  assertExactJsonKeys(input, validated);
  return parseJsonValue(validated) as DeepReadonly<z.output<Schema>>;
}

export function parseSchemaInput<Schema extends z.ZodType>(
  schema: Schema,
  input: unknown,
): DeepReadonly<z.output<Schema>> {
  return parseParsedSchemaInput(schema, parseJsonValue(input));
}
