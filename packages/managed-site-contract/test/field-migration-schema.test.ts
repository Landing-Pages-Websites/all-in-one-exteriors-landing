import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { Ajv2020 } from "ajv/dist/2020.js";

import { generateManagedSiteFieldMigrationJsonSchemaV1 } from "../src/field-migration-json-schema.js";
import { canonicalizeJson } from "../src/index.js";
import { migrationCase, steps } from "./field-migration-fixture.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const artifact = JSON.parse(
  readFileSync(resolve(packageRoot, "schema/managed-site.migration.v1.schema.json"), "utf8"),
) as Record<string, unknown>;

describe("managed-site.migration.json schema artifact", () => {
  const validate = new Ajv2020({ strict: false }).compile(artifact);

  it("is the projection of the parser's schema", () => {
    assert.equal(canonicalizeJson(artifact), canonicalizeJson(generateManagedSiteFieldMigrationJsonSchemaV1()));
  });

  it("accepts the #73 declaration", () => {
    assert.equal(validate(migrationCase().declaration), true, JSON.stringify(validate.errors));
  });

  const refused: readonly [string, (declaration: Record<string, unknown>) => void][] = [
    ["an unknown key", (declaration) => { declaration.note = "x"; }],
    ["a deferred op", (declaration) => { (steps({ declaration } as never)[0]).op = "split"; }],
    ["a missing from", (declaration) => { delete declaration.from; }],
    ["an empty literal", (declaration) => {
      const step = steps({ declaration } as never)[0];
      (step.parts as Record<string, unknown>[])[1] = { literal: "" };
    }],
  ];
  for (const [name, mutate] of refused) {
    it(`refuses ${name}`, () => {
      const declaration = migrationCase().declaration;
      mutate(declaration);
      assert.equal(validate(declaration), false);
    });
  }
});
