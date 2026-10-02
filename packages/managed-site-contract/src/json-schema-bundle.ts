import * as z from "zod";

import { canonicalizeJson } from "./canonical.js";
import { managedSiteContentDocumentSchema } from "./content.js";
import { managedSiteContractV1Schema } from "./contract.js";
import type { DeepReadonly } from "./deep-readonly.js";
import { parseJsonValue, type JsonValue } from "./json.js";
import {
  MANAGED_SITE_SEMANTIC_IDS,
  MANAGED_SITE_SEMANTIC_KEYWORD,
  MANAGED_SITE_ROOT_SEMANTICS,
} from "./schema-semantics.js";

export const MANAGED_SITE_JSON_SCHEMA_DIALECT_V1 =
  "https://schemas.gomega.ai/managed-site/v1/dialect";
export const MANAGED_SITE_JSON_SCHEMA_VOCABULARY_V1 =
  "https://schemas.gomega.ai/managed-site/v1/vocabulary";
export const MANAGED_SITE_JSON_SCHEMA_BUNDLE_V1_ID =
  "https://schemas.gomega.ai/managed-site/v1/bundle";
export const MANAGED_SITE_CONTRACT_V1_SCHEMA_ID =
  "https://schemas.gomega.ai/managed-site/v1/contract";
export const MANAGED_SITE_CONTENT_V1_SCHEMA_ID =
  "https://schemas.gomega.ai/managed-site/v1/content";

interface JsonSchemaRoots {
  readonly ManagedSiteContractV1: JsonValue;
  readonly ManagedSiteContentDocument: JsonValue;
}

export type ManagedSiteJsonSchemaBundleV1 = DeepReadonly<{
  readonly $schema: string;
  readonly $id: string;
  readonly $defs: JsonSchemaRoots;
}>;

function addStrictTypeToRefSiblings(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const child of value) addStrictTypeToRefSiblings(child);
    return;
  }
  const schema = value as Record<string, unknown>;
  const hasStringBound =
    schema.minLength !== undefined || schema.maxLength !== undefined;
  if (typeof schema.$ref === "string" && schema.type === undefined && hasStringBound) {
    schema.type = "string";
  }
  for (const child of Object.values(schema)) addStrictTypeToRefSiblings(child);
}

function projectRoot(schema: z.ZodType, id: string): JsonValue {
  const projected = z.toJSONSchema(schema, {
    target: "draft-2020-12",
    io: "input",
    cycles: "throw",
    reused: "ref",
    unrepresentable: "any",
  });
  addStrictTypeToRefSiblings(projected);
  return parseJsonValue({ ...projected, $schema: MANAGED_SITE_JSON_SCHEMA_DIALECT_V1, $id: id });
}

function collectSemanticIds(value: JsonValue, ids: Set<string>): void {
  if (value === null || typeof value !== "object") return;
  if (isJsonArray(value)) {
    for (const child of value) collectSemanticIds(child, ids);
    return;
  }
  const semantic = value[MANAGED_SITE_SEMANTIC_KEYWORD];
  if (typeof semantic === "string") ids.add(semantic);
  for (const child of Object.values(value)) collectSemanticIds(child, ids);
}

function isJsonArray(value: JsonValue): value is readonly JsonValue[] {
  return Array.isArray(value);
}

function semanticAtRoot(bundle: JsonValue, root: keyof JsonSchemaRoots): unknown {
  if (bundle === null || typeof bundle !== "object" || isJsonArray(bundle)) return undefined;
  const definitions = bundle.$defs;
  if (definitions === null || typeof definitions !== "object" || isJsonArray(definitions)) {
    return undefined;
  }
  const schema = definitions[root];
  if (schema === null || typeof schema !== "object" || isJsonArray(schema)) return undefined;
  return schema[MANAGED_SITE_SEMANTIC_KEYWORD];
}

function assertRootSemanticGates(bundle: JsonValue): void {
  for (const [root, semantic] of Object.entries(MANAGED_SITE_ROOT_SEMANTICS)) {
    if (semanticAtRoot(bundle, root as keyof JsonSchemaRoots) !== semantic) {
      throw new Error(`Managed-site JSON Schema root semantic is missing: ${root}`);
    }
  }
}

export function assertCompleteManagedSiteSemanticVocabularyV1(bundle: JsonValue): void {
  assertRootSemanticGates(bundle);
  const actual = new Set<string>();
  collectSemanticIds(bundle, actual);
  const missing = MANAGED_SITE_SEMANTIC_IDS.filter((id) => !actual.has(id));
  const unknown = [...actual].filter(
    (id) => !(MANAGED_SITE_SEMANTIC_IDS as readonly string[]).includes(id),
  );
  if (missing.length > 0 || unknown.length > 0) {
    throw new Error("Managed-site JSON Schema semantic vocabulary is incomplete");
  }
}

export function generateManagedSiteJsonSchemaBundleV1(): ManagedSiteJsonSchemaBundleV1 {
  const contract = projectRoot(
    managedSiteContractV1Schema,
    MANAGED_SITE_CONTRACT_V1_SCHEMA_ID,
  );
  const content = projectRoot(
    managedSiteContentDocumentSchema,
    MANAGED_SITE_CONTENT_V1_SCHEMA_ID,
  );
  const bundle = parseJsonValue({
    $schema: MANAGED_SITE_JSON_SCHEMA_DIALECT_V1,
    $id: MANAGED_SITE_JSON_SCHEMA_BUNDLE_V1_ID,
    $defs: {
      ManagedSiteContractV1: contract,
      ManagedSiteContentDocument: content,
    },
  });
  assertCompleteManagedSiteSemanticVocabularyV1(bundle);
  return bundle as ManagedSiteJsonSchemaBundleV1;
}

export function formatManagedSiteJsonSchemaBundleV1(input: unknown): string {
  const sorted = JSON.parse(canonicalizeJson(parseJsonValue(input)));
  return `${JSON.stringify(sorted, null, 2)}\n`;
}

export const MANAGED_SITE_JSON_SCHEMA_BUNDLE_V1 =
  generateManagedSiteJsonSchemaBundleV1();
