import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { Ajv2020 } from "ajv/dist/2020.js";

import {
  MANAGED_SITE_CONTRACT_V1_SCHEMA_ID,
  MANAGED_SITE_CONTENT_V1_SCHEMA_ID,
  MANAGED_SITE_JSON_SCHEMA_BUNDLE_V1,
  validateManagedSiteContentDocumentJsonSchema,
  validateManagedSiteContractV1JsonSchema,
  type ManagedSiteJsonSchemaBundleV1,
} from "../src/index.js";
import {
  formatManagedSiteJsonSchemaBundleV1,
  generateManagedSiteJsonSchemaBundleV1,
  MANAGED_SITE_JSON_SCHEMA_VOCABULARY_V1,
} from "../src/json-schema-bundle.js";
import {
  compileManagedSiteJsonSchemaBundleV1,
  managedSiteDialectMetaSchemaV1,
  registerManagedSiteVocabularyV1,
} from "../src/json-schema-validator.js";
import { contentDocument, managedSiteContract } from "./schema-fixtures.js";

const SNAPSHOT_URL = new URL(
  "../schema/managed-site.v1.schema.json",
  import.meta.url,
);

function cloneBundle(): ManagedSiteJsonSchemaBundleV1 {
  return structuredClone(MANAGED_SITE_JSON_SCHEMA_BUNDLE_V1);
}

function removeFirstSemanticKeyword(value: unknown): boolean {
  if (value === null || typeof value !== "object") return false;
  if (!Array.isArray(value) && Object.hasOwn(value, "gomegaSemanticV1")) {
    delete (value as Record<string, unknown>).gomegaSemanticV1;
    return true;
  }
  return Object.values(value).some(removeFirstSemanticKeyword);
}

function replaceFirstFormat(value: unknown, replacement: string): boolean {
  if (value === null || typeof value !== "object") return false;
  if (!Array.isArray(value) && typeof (value as Record<string, unknown>).format === "string") {
    (value as Record<string, unknown>).format = replacement;
    return true;
  }
  return Object.values(value).some((child) => replaceFirstFormat(child, replacement));
}

function semanticAtRoot(
  bundle: ManagedSiteJsonSchemaBundleV1,
  root: keyof ManagedSiteJsonSchemaBundleV1["$defs"],
): unknown {
  return (bundle.$defs[root] as Record<string, unknown>).gomegaSemanticV1;
}

function assertCanonicalRootSemantics(): void {
  assert.equal(
    semanticAtRoot(MANAGED_SITE_JSON_SCHEMA_BUNDLE_V1, "ManagedSiteContractV1"),
    "managed-site-contract-v1-root",
  );
  assert.equal(
    semanticAtRoot(MANAGED_SITE_JSON_SCHEMA_BUNDLE_V1, "ManagedSiteContentDocument"),
    "managed-site-content-document-root",
  );
}

type BundleMutation = (bundle: ManagedSiteJsonSchemaBundleV1) => void;

const ROOT_SEMANTIC_MUTATIONS: readonly BundleMutation[] = [
  (bundle) => {
    delete (bundle.$defs.ManagedSiteContractV1 as Record<string, unknown>)
      .gomegaSemanticV1;
  },
  (bundle) => {
    const contract = bundle.$defs.ManagedSiteContractV1 as Record<string, unknown>;
    const content = bundle.$defs.ManagedSiteContentDocument as Record<string, unknown>;
    [contract.gomegaSemanticV1, content.gomegaSemanticV1] = [
      content.gomegaSemanticV1,
      contract.gomegaSemanticV1,
    ];
  },
  (bundle) => {
    const contract = bundle.$defs.ManagedSiteContractV1 as Record<string, unknown>;
    const semantic = contract.gomegaSemanticV1;
    delete contract.gomegaSemanticV1;
    (contract.properties as Record<string, unknown>).gomegaSemanticV1 = semantic;
  },
];

function assertMissingFormatsAreRefused(): void {
  const ajv = new Ajv2020({ strict: true, validateFormats: true });
  ajv.addKeyword({
    keyword: "gomegaSemanticV1",
    schemaType: "string",
    validate: () => true,
  });
  ajv.addMetaSchema(managedSiteDialectMetaSchemaV1);
  ajv.addSchema(cloneBundle());
  assert.throws(
    () => ajv.getSchema(MANAGED_SITE_CONTRACT_V1_SCHEMA_ID),
    /unknown format/iu,
  );
}

function assertUnknownFormatsAreRefused(): void {
  const bundle = cloneBundle();
  assert.equal(replaceFirstFormat(bundle, "gomega-unknown-v1"), true);
  const ajv = new Ajv2020({ strict: true, validateFormats: true });
  registerManagedSiteVocabularyV1(ajv);
  ajv.addMetaSchema(managedSiteDialectMetaSchemaV1);
  ajv.addSchema(bundle);
  assert.throws(
    () => ajv.getSchema(MANAGED_SITE_CONTRACT_V1_SCHEMA_ID),
    /unknown format/iu,
  );
}

describe("managed-site JSON Schema bundle", () => {
  it("generates one deterministic frozen Draft 2020-12 bundle with two roots", () => {
    const first = generateManagedSiteJsonSchemaBundleV1();
    const second = generateManagedSiteJsonSchemaBundleV1();

    assert.deepEqual(first, second);
    assert.deepEqual(first, MANAGED_SITE_JSON_SCHEMA_BUNDLE_V1);
    assert.equal(Object.isFrozen(first), true);
    assert.equal(Object.isFrozen(first.$defs), true);
    assert.match(MANAGED_SITE_CONTRACT_V1_SCHEMA_ID, /\/contract$/u);
    assert.match(MANAGED_SITE_CONTENT_V1_SCHEMA_ID, /\/content$/u);
  });

  it("keeps the checked artifact at the generator fixed point", () => {
    const generated = formatManagedSiteJsonSchemaBundleV1(
      generateManagedSiteJsonSchemaBundleV1(),
    );
    assert.equal(readFileSync(SNAPSHOT_URL, "utf8"), generated);
    assert.equal(
      formatManagedSiteJsonSchemaBundleV1(JSON.parse(generated)),
      generated,
    );
  });

  it("resolves both embedded resource IDs with the strict package validator", () => {
    const validators = compileManagedSiteJsonSchemaBundleV1(
      MANAGED_SITE_JSON_SCHEMA_BUNDLE_V1,
    );
    assert.equal(validators.contract(managedSiteContract()), true);
    assert.equal(validators.content(contentDocument()), true);
  });

  it("pins each canonical root semantic gate to its exact embedded path", () => {
    assertCanonicalRootSemantics();
    for (const mutate of ROOT_SEMANTIC_MUTATIONS) {
      const bundle = cloneBundle();
      mutate(bundle);
      assert.throws(
        () => compileManagedSiteJsonSchemaBundleV1(bundle),
        /projection|semantic|vocabulary/iu,
      );
    }
  });

  it("requires the package dialect and every semantic keyword", () => {
    assert.equal(
      managedSiteDialectMetaSchemaV1.$vocabulary[
        MANAGED_SITE_JSON_SCHEMA_VOCABULARY_V1
      ],
      true,
    );
    const generic = new Ajv2020({ strict: true });
    assert.throws(() => generic.addSchema(cloneBundle()), /schema|reference/iu);

    const missingKeyword = new Ajv2020({ strict: true });
    missingKeyword.addMetaSchema(managedSiteDialectMetaSchemaV1);
    missingKeyword.addSchema(cloneBundle());
    assert.throws(
      () => missingKeyword.getSchema(MANAGED_SITE_CONTRACT_V1_SCHEMA_ID),
      /keyword|strict mode/iu,
    );

    const incomplete = cloneBundle();
    assert.equal(removeFirstSemanticKeyword(incomplete), true);
    assert.throws(
      () => compileManagedSiteJsonSchemaBundleV1(incomplete),
      /vocabulary|semantic|projection/iu,
    );
  });

  it("requires format assertion and refuses missing or unknown format support", () => {
    assert.equal(
      (managedSiteDialectMetaSchemaV1.$vocabulary as Readonly<Record<string, boolean>>)[
        "https://json-schema.org/draft/2020-12/vocab/format-assertion"
      ],
      true,
    );

    assert.throws(
      () => registerManagedSiteVocabularyV1(
        new Ajv2020({ strict: true, validateFormats: false }),
      ),
      /format assertion|validateFormats/iu,
    );

    assertMissingFormatsAreRefused();
    assertUnknownFormatsAreRefused();
  });

  it("returns bounded frozen errors after the C1 hostile-input gate", () => {
    const invalidContract = managedSiteContract();
    invalidContract.schemaVersion = "2.0";
    const invalidContent = contentDocument();
    invalidContent.extra = true;

    for (const result of [
      validateManagedSiteContractV1JsonSchema(invalidContract),
      validateManagedSiteContentDocumentJsonSchema(invalidContent),
    ]) {
      assert.equal(result.valid, false);
      assert.equal(Object.isFrozen(result), true);
      if (!result.valid) {
        assert.ok(result.errors.length > 0 && result.errors.length <= 100);
        assert.equal(Object.isFrozen(result.errors), true);
      }
    }

    let trapCount = 0;
    const hostile = new Proxy({}, { ownKeys: () => { trapCount += 1; return []; } });
    assert.equal(validateManagedSiteContractV1JsonSchema(hostile).valid, false);
    assert.equal(trapCount, 0);
  });
});
