import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  formatManagedSiteJsonSchemaBundleV1,
  generateManagedSiteJsonSchemaBundleV1,
} from "../dist/json-schema-bundle.js";
import { generateManagedSiteFieldMigrationJsonSchemaV1 } from "../dist/field-migration-json-schema.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const artifactPath = resolve(
  packageRoot,
  "schema/managed-site.v1.schema.json",
);
const migrationArtifactPath = resolve(
  packageRoot,
  "schema/managed-site.migration.v1.schema.json",
);
const expected = formatManagedSiteJsonSchemaBundleV1(
  generateManagedSiteJsonSchemaBundleV1(),
);

if (readFileSync(artifactPath, "utf8") !== expected) {
  throw new Error(
    "Managed-site JSON Schema snapshot is stale; run npm run schema:generate",
  );
}

const expectedMigration = formatManagedSiteJsonSchemaBundleV1(
  generateManagedSiteFieldMigrationJsonSchemaV1(),
);

if (readFileSync(migrationArtifactPath, "utf8") !== expectedMigration) {
  throw new Error(
    "Managed-site migration JSON Schema snapshot is stale; run npm run schema:generate",
  );
}
