import * as z from "zod";

import type { DeepReadonly } from "./deep-readonly.js";
import { managedSiteFieldMigrationV1Schema } from "./field-migration-schema.js";
import { parseJsonValue, type JsonValue } from "./json.js";

export const MANAGED_SITE_FIELD_MIGRATION_V1_SCHEMA_ID =
  "https://schemas.gomega.ai/managed-site/v1/migration";

export type ManagedSiteFieldMigrationJsonSchemaV1 = DeepReadonly<JsonValue>;

/**
 * The published shape of `managed-site.migration.json`, projected from the
 * same zod schema the parser runs. The verifier is the authority: what this
 * schema cannot express (each mark kind once, a merge consumes a source,
 * plain text carries no marks, a stable id's checksum) the parser refuses.
 */
export function generateManagedSiteFieldMigrationJsonSchemaV1(): ManagedSiteFieldMigrationJsonSchemaV1 {
  const projected = z.toJSONSchema(managedSiteFieldMigrationV1Schema, {
    target: "draft-2020-12",
    io: "input",
    cycles: "throw",
    reused: "inline",
    unrepresentable: "any",
  });
  return parseJsonValue({ ...projected, $id: MANAGED_SITE_FIELD_MIGRATION_V1_SCHEMA_ID });
}
