import * as z from "zod";

import type { DeepReadonly } from "./deep-readonly.js";
import { ManagedSiteContractError } from "./errors.js";
import { parseJsonValue, type JsonValue } from "./json.js";
import { isJsonRecord } from "./json-record.js";
import { managedRichTextHeadingLevelSchema } from "./rich-text.js";
import { parseParsedSchemaInput } from "./schema-input.js";
import {
  managedLinkDestinationSchema,
  managedLinkTargetSchema,
  stableIdSchema,
} from "./values.js";

/** The sidecar file a site commits beside its contract when fields migrate. */
export const MANAGED_SITE_FIELD_MIGRATION_FILE = "managed-site.migration.json";

/**
 * The transforms this version proves. Anything else a declaration names
 * (split, retire, rename, type_widen, collection items, alias groups) is
 * refused as deferred rather than read as something it is not.
 */
export const MANAGED_SITE_FIELD_MIGRATION_OPS = Object.freeze(["merge"] as const);

const sha256HexSchema = z.string().regex(/^[a-f0-9]{64}$/);

/**
 * A declared link reaches a page of this site or an https URL. Email and
 * phone links stay content: code may not add one through a migration.
 */
const migrationLinkDestinationSchema = managedLinkDestinationSchema.refine(
  (destination) =>
    destination.kind === "internal" || destination.kind === "external",
  "A migration link names an internal page or an external URL",
);

const migrationMarkSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("italic") }),
  z.strictObject({ type: z.literal("bold") }),
  z.strictObject({
    type: z.literal("link"),
    destination: migrationLinkDestinationSchema,
    target: managedLinkTargetSchema,
  }),
]);

/** At most one mark of each kind, exactly as a rich-text text node allows. */
const migrationMarksSchema = z
  .array(migrationMarkSchema)
  .min(1)
  .max(3)
  .refine(
    (marks) => new Set(marks.map((mark) => mark.type)).size === marks.length,
    "A part carries each mark kind at most once",
  );

/**
 * How a part meets the one before it. Absent means directly, text against
 * text. `hard_break` puts one `hard_break` node between them, and it is only
 * ever declared: no part's text, newline included, becomes a break. It is a
 * property of the part, not of the step, because a line of a block may be
 * several parts (a plain "Activate", a literal space, an italic "Real-World").
 */
const MANAGED_SITE_FIELD_MIGRATION_JOINS = Object.freeze(["hard_break"] as const);
const migrationJoinSchema = z.enum(MANAGED_SITE_FIELD_MIGRATION_JOINS);

const sourcePartSchema = z.strictObject({
  source: stableIdSchema("field"),
  marks: migrationMarksSchema.optional(),
  joinedBy: migrationJoinSchema.optional(),
});

const literalPartSchema = z.strictObject({
  literal: z.string().min(1).max(1_000),
  marks: migrationMarksSchema.optional(),
  joinedBy: migrationJoinSchema.optional(),
});

const migrationPartSchema = z.union([sourcePartSchema, literalPartSchema]);

const migrationBlockSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("paragraph") }),
  z.strictObject({
    type: z.literal("heading"),
    // The levels a rich-text heading block admits, from its own schema, so a
    // level the contract adds is one a migration can declare.
    level: managedRichTextHeadingLevelSchema,
  }),
  z.strictObject({ type: z.literal("bullet_list") }),
]);

const migrationIntoSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("plain_text") }),
  z.strictObject({ type: z.literal("rich_text"), block: migrationBlockSchema }),
]);

const mergeStepSchema = z
  .strictObject({
    op: z.literal("merge"),
    target: stableIdSchema("field"),
    into: migrationIntoSchema,
    parts: z.array(migrationPartSchema).min(1).max(64),
  })
  .refine(
    (step) => step.parts.some((part) => "source" in part),
    "A merge consumes at least one source",
  )
  .refine(
    (step) =>
      step.into.type !== "plain_text" ||
      step.parts.every((part) => part.marks === undefined),
    "Plain text carries no marks",
  )
  .refine(
    (step) => step.parts.every((part, index) => part.joinedBy === undefined || index > 0),
    "The first part has no part before it to be joined to",
  )
  .refine(
    (step) =>
      step.parts.every((part) => part.joinedBy === undefined) ||
      (step.into.type === "rich_text" && step.into.block.type !== "bullet_list"),
    "A hard break joins parts inside one paragraph or heading, not plain text or list items",
  );

const bridgeVersionSchema = z.string().regex(/^v[1-9]\d{0,3}$/);

export const managedSiteFieldMigrationV1Schema = z.strictObject({
  schemaVersion: z.literal("1.0"),
  from: z.strictObject({
    contractSha256: sha256HexSchema,
    contentSha256: sha256HexSchema,
  }),
  bridge: z
    .strictObject({ from: bridgeVersionSchema, to: bridgeVersionSchema })
    .optional(),
  steps: z.array(mergeStepSchema).max(1_000),
});

export type ManagedSiteFieldMigrationV1 = DeepReadonly<
  z.infer<typeof managedSiteFieldMigrationV1Schema>
>;
export type ManagedSiteFieldMigrationStepV1 =
  ManagedSiteFieldMigrationV1["steps"][number];
export type ManagedSiteFieldMigrationPartV1 =
  ManagedSiteFieldMigrationStepV1["parts"][number];
export type ManagedSiteFieldMigrationMarkV1 = NonNullable<
  ManagedSiteFieldMigrationPartV1["marks"]
>[number];
export type ManagedSiteFieldMigrationBlockV1 = Extract<
  ManagedSiteFieldMigrationStepV1["into"],
  { type: "rich_text" }
>["block"];

function deferredOp(step: JsonValue): string | null {
  if (!isJsonRecord(step)) return null;
  const op = step.op;
  if (typeof op !== "string") return null;
  return (MANAGED_SITE_FIELD_MIGRATION_OPS as readonly string[]).includes(op)
    ? null
    : op;
}

/**
 * An op this version cannot prove is refused by name before the schema runs,
 * so a declaration of a split reads as "deferred", not as a malformed merge.
 */
function assertNoDeferredOps(input: JsonValue): void {
  if (!isJsonRecord(input) || !Array.isArray(input.steps)) return;
  for (const step of input.steps as readonly JsonValue[]) {
    const op = deferredOp(step);
    if (op === null) continue;
    throw new ManagedSiteContractError(
      "MIGRATION_TRANSFORM_DEFERRED",
      `Migration op is not supported yet: ${op}`,
    );
  }
}

export function parseManagedSiteFieldMigrationV1(
  input: unknown,
): ManagedSiteFieldMigrationV1 {
  const parsed = parseJsonValue(input);
  assertNoDeferredOps(parsed);
  try {
    return parseParsedSchemaInput(managedSiteFieldMigrationV1Schema, parsed);
  } catch (error) {
    if (error instanceof ManagedSiteContractError) throw error;
    throw new ManagedSiteContractError(
      "MIGRATION_DECLARATION_INVALID",
      "Migration declaration does not match its schema",
    );
  }
}
