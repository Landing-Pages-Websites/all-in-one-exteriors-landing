import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  applyManagedSiteFieldMigrationStepV1,
  managedSiteFieldMigrationFromV1,
  parseManagedSiteContentDocument,
  parseManagedSiteContractV1,
  parseManagedSiteFieldMigrationV1,
  validateManagedSiteContractV1MigrationCompatibility,
  type ManagedSiteBridgeAdmission,
  type ManagedSiteContentValue,
  type ManagedSiteFieldMigrationProofV1,
} from "../src/index.js";

/**
 * All Points Media #73 (base 3670a82, head e093bd4), trimmed to the pages and
 * sections it touched: 34 merge targets, 69 retired sources, and the internal
 * SEO values those pages need. The real declaration, run on the real values.
 */
const FIXTURE_DIRECTORY = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures/field-migration-73",
);

export type Json = Record<string, unknown>;

export interface MigrationCase {
  productionContract: Json;
  productionContent: Json;
  candidateContract: Json;
  candidateContent: Json;
  declaration: Json;
}

function read(name: string): Json {
  return JSON.parse(readFileSync(resolve(FIXTURE_DIRECTORY, `${name}.json`), "utf8")) as Json;
}

const FIXTURE: MigrationCase = Object.freeze({
  productionContract: read("production.contract"),
  productionContent: read("production.content"),
  candidateContract: read("candidate.contract"),
  candidateContent: read("candidate.content"),
  declaration: read("migration"),
});

export function migrationCase(): MigrationCase {
  return structuredClone(FIXTURE) as MigrationCase;
}

export const admitEveryBridge: ManagedSiteBridgeAdmission = () => true;

export function verifyCase(
  migration: MigrationCase,
  admitBridge: ManagedSiteBridgeAdmission = admitEveryBridge,
): ManagedSiteFieldMigrationProofV1 {
  return validateManagedSiteContractV1MigrationCompatibility(
    parseManagedSiteContractV1(migration.productionContract),
    parseManagedSiteContentDocument(migration.productionContent),
    parseManagedSiteContractV1(migration.candidateContract),
    parseManagedSiteContentDocument(migration.candidateContent),
    migration.declaration,
    { admitBridge },
  );
}

export function steps(migration: MigrationCase): Json[] {
  return migration.declaration.steps as Json[];
}

export function parts(step: Json): Json[] {
  return step.parts as Json[];
}

export function values(content: Json): Json[] {
  return content.values as Json[];
}

export function stepFor(migration: MigrationCase, target: string): Json {
  const found = steps(migration).find((step) => step.target === target);
  if (found === undefined) throw new Error(`No step for ${target}`);
  return found;
}

export function valueOf(content: Json, fieldId: string): Json {
  const found = values(content).find((value) => value.fieldId === fieldId);
  if (found === undefined) throw new Error(`No value for ${fieldId}`);
  return found;
}

export function allFields(contract: Json): Json[] {
  return (contract.pages as Json[]).flatMap((page) =>
    (page.sections as Json[]).flatMap((section) => section.fields as Json[]),
  );
}

export function fieldOf(contract: Json, fieldId: string): Json {
  const found = allFields(contract).find((field) => field.id === fieldId);
  if (found === undefined) throw new Error(`No field ${fieldId}`);
  return found;
}

/** Re-signs the declaration against production as it now stands. */
export function refreshFrom(migration: MigrationCase): void {
  migration.declaration.from = managedSiteFieldMigrationFromV1(
    parseManagedSiteContractV1(migration.productionContract),
    parseManagedSiteContentDocument(migration.productionContent),
  );
}

/**
 * Rewrites a candidate target to exactly F of its step, so a case changes the
 * DECLARATION and the candidate agrees with it: the strongest forgery, where
 * only the verifier's other rules stand between it and a pass.
 */
export function rebuildTarget(migration: MigrationCase, target: string): void {
  const step = parseManagedSiteFieldMigrationV1({
    ...migration.declaration,
    steps: [stepFor(migration, target)],
  }).steps[0];
  const production = parseManagedSiteContentDocument(migration.productionContent);
  const sources = new Map<string, ManagedSiteContentValue>(
    production.values.map((value) => [value.fieldId, value]),
  );
  valueOf(migration.candidateContent, target).value =
    structuredClone(applyManagedSiteFieldMigrationStepV1(step, sources).value);
}
