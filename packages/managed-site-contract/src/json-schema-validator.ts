import {
  Ajv2020,
  type ErrorObject,
  type KeywordDefinition,
  type ValidateFunction,
} from "ajv/dist/2020.js";
import * as z from "zod";

import { canonicalizeJson } from "./canonical.js";
import type { DeepReadonly } from "./deep-readonly.js";
import {
  assertCompleteManagedSiteSemanticVocabularyV1,
  MANAGED_SITE_CONTENT_V1_SCHEMA_ID,
  MANAGED_SITE_CONTRACT_V1_SCHEMA_ID,
  MANAGED_SITE_JSON_SCHEMA_BUNDLE_V1,
  MANAGED_SITE_JSON_SCHEMA_DIALECT_V1,
  MANAGED_SITE_JSON_SCHEMA_VOCABULARY_V1,
  type ManagedSiteJsonSchemaBundleV1,
} from "./json-schema-bundle.js";
import { parseJsonValue } from "./json.js";
import {
  getManagedSiteSemanticSchema,
  MANAGED_SITE_SEMANTIC_IDS,
  MANAGED_SITE_SEMANTIC_KEYWORD,
  type ManagedSiteSemanticId,
} from "./schema-semantics.js";
import { parseJsonPointer, parseRepositoryPath } from "./source.js";
import { isManagedServedAssetPath } from "./values.js";

const MAX_VALIDATION_ERRORS = 100;
const MAX_ERROR_TEXT = 2_048;
const DRAFT_2020_VOCABULARIES = [
  "https://json-schema.org/draft/2020-12/vocab/core",
  "https://json-schema.org/draft/2020-12/vocab/applicator",
  "https://json-schema.org/draft/2020-12/vocab/unevaluated",
  "https://json-schema.org/draft/2020-12/vocab/validation",
  "https://json-schema.org/draft/2020-12/vocab/meta-data",
  "https://json-schema.org/draft/2020-12/vocab/format-annotation",
  "https://json-schema.org/draft/2020-12/vocab/format-assertion",
  "https://json-schema.org/draft/2020-12/vocab/content",
] as const;

export const managedSiteDialectMetaSchemaV1 = Object.freeze({
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: MANAGED_SITE_JSON_SCHEMA_DIALECT_V1,
  $vocabulary: Object.freeze({
    ...Object.fromEntries(DRAFT_2020_VOCABULARIES.map((uri) => [uri, true])),
    [MANAGED_SITE_JSON_SCHEMA_VOCABULARY_V1]: true,
  }),
  allOf: Object.freeze([
    Object.freeze({ $ref: "https://json-schema.org/draft/2020-12/schema" }),
  ]),
});

export interface ManagedSiteJsonSchemaIssue {
  readonly instancePath: string;
  readonly keyword: string;
  readonly message: string;
}

export type ManagedSiteJsonSchemaValidationResult = DeepReadonly<
  | { readonly valid: true }
  | {
      readonly valid: false;
      readonly errors: readonly ManagedSiteJsonSchemaIssue[];
    }
>;

export interface ManagedSiteJsonSchemaValidatorsV1 {
  readonly contract: ValidateFunction;
  readonly content: ValidateFunction;
}

function accepts(check: () => unknown): boolean {
  try {
    check();
    return true;
  } catch {
    return false;
  }
}

function semanticKeyword(): KeywordDefinition {
  return {
    keyword: MANAGED_SITE_SEMANTIC_KEYWORD,
    schemaType: "string",
    post: true,
    errors: false,
    metaSchema: { enum: MANAGED_SITE_SEMANTIC_IDS },
    compile: (id: ManagedSiteSemanticId) => {
      const schema = getManagedSiteSemanticSchema(id);
      return (input: unknown): boolean => schema.safeParse(input).success;
    },
  };
}

function addFormats(ajv: Ajv2020): void {
  ajv.addFormat("uri", (value: string) => accepts(() => new URL(value)));
  ajv.addFormat("email", (value: string) => z.email().safeParse(value).success);
  ajv.addFormat("hostname", (value: string) => z.hostname().safeParse(value).success);
  ajv.addFormat("gomega-repository-path-v1", (value: string) =>
    accepts(() => parseRepositoryPath(value)),
  );
  ajv.addFormat("gomega-served-asset-path-v1", isManagedServedAssetPath);
  ajv.addFormat("gomega-json-pointer-v1", (value: string) =>
    accepts(() => parseJsonPointer(value)),
  );
}

export function registerManagedSiteVocabularyV1(ajv: Ajv2020): void {
  if (ajv.opts.validateFormats !== true) {
    throw new Error("Managed-site format assertion requires validateFormats: true");
  }
  ajv.addKeyword(semanticKeyword());
  addFormats(ajv);
}

function createManagedSiteAjvV1(): Ajv2020 {
  const ajv = new Ajv2020({
    allErrors: true,
    ownProperties: true,
    strict: true,
    validateFormats: true,
  });
  registerManagedSiteVocabularyV1(ajv);
  ajv.addMetaSchema(managedSiteDialectMetaSchemaV1);
  return ajv;
}

function assertTrustedBundle(bundle: ManagedSiteJsonSchemaBundleV1): void {
  assertCompleteManagedSiteSemanticVocabularyV1(bundle);
  if (
    canonicalizeJson(bundle) !== canonicalizeJson(MANAGED_SITE_JSON_SCHEMA_BUNDLE_V1)
  ) {
    throw new Error("Managed-site JSON Schema projection or vocabulary is incomplete");
  }
}

function requireValidator(ajv: Ajv2020, id: string): ValidateFunction {
  const validator = ajv.getSchema(id);
  if (validator === undefined) {
    throw new Error(`Managed-site JSON Schema root did not resolve: ${id}`);
  }
  return validator;
}

export function compileManagedSiteJsonSchemaBundleV1(
  bundle: ManagedSiteJsonSchemaBundleV1,
): ManagedSiteJsonSchemaValidatorsV1 {
  assertTrustedBundle(bundle);
  const ajv = createManagedSiteAjvV1();
  ajv.addSchema(bundle);
  return Object.freeze({
    contract: requireValidator(ajv, MANAGED_SITE_CONTRACT_V1_SCHEMA_ID),
    content: requireValidator(ajv, MANAGED_SITE_CONTENT_V1_SCHEMA_ID),
  });
}

function issueFrom(error: ErrorObject): ManagedSiteJsonSchemaIssue {
  return {
    instancePath: error.instancePath.slice(0, MAX_ERROR_TEXT),
    keyword: error.keyword.slice(0, MAX_ERROR_TEXT),
    message: (error.message ?? "JSON Schema validation failed").slice(
      0,
      MAX_ERROR_TEXT,
    ),
  };
}

function invalidResult(
  errors: readonly ManagedSiteJsonSchemaIssue[],
): ManagedSiteJsonSchemaValidationResult {
  return parseJsonValue({ valid: false, errors }) as ManagedSiteJsonSchemaValidationResult;
}

function validateWith(
  validator: ValidateFunction,
  input: unknown,
): ManagedSiteJsonSchemaValidationResult {
  let parsed: unknown;
  try {
    parsed = parseJsonValue(input);
  } catch {
    return invalidResult([
      { instancePath: "", keyword: "gomegaCanonicalJsonV1", message: "Input is not canonical JSON" },
    ]);
  }
  if (validator(parsed)) return Object.freeze({ valid: true });
  return invalidResult(
    (validator.errors ?? []).slice(0, MAX_VALIDATION_ERRORS).map(issueFrom),
  );
}

const validators = compileManagedSiteJsonSchemaBundleV1(
  MANAGED_SITE_JSON_SCHEMA_BUNDLE_V1,
);

export function validateManagedSiteContractV1JsonSchema(
  input: unknown,
): ManagedSiteJsonSchemaValidationResult {
  return validateWith(validators.contract, input);
}

export function validateManagedSiteContentDocumentJsonSchema(
  input: unknown,
): ManagedSiteJsonSchemaValidationResult {
  return validateWith(validators.content, input);
}
