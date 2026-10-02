import { createHash } from "node:crypto";

import { canonicalizeJson } from "./canonical.js";
import {
  validateParsedManagedFieldValue,
  type ManagedSiteContentDocument,
  type ManagedSiteContentValue,
} from "./content.js";
import { validateManagedSiteContractV1ContentSemantics } from "./content-semantics.js";
import { contentValueKey } from "./content-semantics-facts.js";
import {
  collectManagedContractCompatibilityFacts,
  type ManagedContractCompatibilityFacts,
} from "./contract-compatibility-facts.js";
import {
  assertManagedContractFactsCompatible,
  assertManifestPreserved,
  validateCompatibilityInputs,
} from "./contract-compatibility-policy.js";
import type { ManagedSiteContractV1 } from "./contract.js";
import { ManagedSiteContractError } from "./errors.js";
import { parseJsonValue } from "./json.js";
import {
  assertManagedSiteFieldMigrationBridgeV1,
  type ManagedSiteBridgeAdmission,
  type ManagedSiteFieldMigrationBridgeStepV1,
} from "./field-migration-bridge.js";
import {
  managedSiteFieldMigrationAddedItems,
  managedSiteFieldMigrationStepProof,
  type ManagedSiteFieldMigrationAccountingV1,
  type ManagedSiteFieldMigrationAdditionsV1,
  type ManagedSiteFieldMigrationProofV1,
  type ManagedSiteFieldMigrationStepProofV1,
} from "./field-migration-proof.js";
import { managedSiteFieldMigrationMoves } from "./field-migration-position.js";
import {
  assertManagedSiteFieldMigrationReferencesV1,
  managedSiteFieldMigrationRenames,
} from "./field-migration-references.js";
import { assertManagedSiteFieldMigrationUrlsV1 } from "./field-migration-urls.js";
import {
  parseManagedSiteFieldMigrationV1,
  type ManagedSiteFieldMigrationV1,
} from "./field-migration-schema.js";
import {
  resolveManagedSiteFieldMigrationStepsV1,
  type ManagedSiteFieldMigrationResolutionV1,
  type ManagedSiteFieldMigrationResolvedStepV1,
} from "./field-migration-steps.js";
import {
  applyManagedSiteFieldMigrationStepV1,
  joinManagedSiteFieldMigrationRuns,
  managedSiteFieldMigrationSourceRuns,
  readBackManagedSiteFieldMigrationStepV1,
  type ManagedSiteFieldMigrationResultV1,
} from "./field-migration-transform.js";

export interface ManagedSiteFieldMigrationOptionsV1 {
  readonly admitBridge: ManagedSiteBridgeAdmission;
}

type ValuesByKey = ReadonlyMap<string, ManagedSiteContentValue>;

function fail(code: string, message: string): never {
  throw new ManagedSiteContractError(code, message);
}

function sha256Canonical(value: unknown): string {
  return createHash("sha256").update(canonicalizeJson(value), "utf8").digest("hex");
}

function canonicalEqual(left: unknown, right: unknown): boolean {
  return canonicalizeJson(left) === canonicalizeJson(right);
}

/**
 * The `from` a declaration names: the sha256 of the canonical JSON of the
 * production contract and content, as the normalized artifacts digest them.
 */
export function managedSiteFieldMigrationFromV1(
  contract: ManagedSiteContractV1,
  content: ManagedSiteContentDocument,
): ManagedSiteFieldMigrationV1["from"] {
  return { contractSha256: sha256Canonical(contract), contentSha256: sha256Canonical(content) };
}

function assertFrom(
  declaration: ManagedSiteFieldMigrationV1,
  contract: ManagedSiteContractV1,
  content: ManagedSiteContentDocument,
): void {
  if (!canonicalEqual(declaration.from, managedSiteFieldMigrationFromV1(contract, content))) {
    fail("MIGRATION_FROM_STALE", "The declaration was written against other production artifacts");
  }
}

function assertRuntimeIdentity(
  production: ManagedSiteContractV1,
  candidate: ManagedSiteContractV1,
): void {
  if (
    production.contractId !== candidate.contractId ||
    !canonicalEqual(production.adapter, candidate.adapter)
  ) {
    fail("MIGRATION_RUNTIME_CHANGED", "Contract id or adapter changed");
  }
}

function valuesByKey(content: ManagedSiteContentDocument): ValuesByKey {
  return new Map(content.values.map((value) => [contentValueKey(value.fieldId, value.owner), value]));
}

/**
 * The invariant: every production value is either unchanged in the candidate or
 * consumed by exactly one step, and no candidate value sits on a source.
 */
function accountForProduction(
  production: ManagedSiteContentDocument,
  candidate: ManagedSiteContentDocument,
  retired: ReadonlySet<string>,
): { readonly unchanged: number; readonly consumed: number } {
  const remaining = candidate.values.find((value) => retired.has(value.fieldId));
  if (remaining !== undefined) {
    fail("MIGRATION_SOURCE_VALUE_REMAINS", `Candidate keeps a value on source ${remaining.fieldId}`);
  }
  const candidateValues = valuesByKey(candidate);
  let unchanged = 0;
  let consumed = 0;
  for (const value of production.values) {
    if (retired.has(value.fieldId)) {
      consumed += 1;
      continue;
    }
    const next = candidateValues.get(contentValueKey(value.fieldId, value.owner));
    if (next === undefined || !canonicalEqual(value, next)) {
      fail("MIGRATION_UNDECLARED_CHANGE", `Production value changed outside a step: ${value.fieldId}`);
    }
    unchanged += 1;
  }
  return { unchanged, consumed };
}

/**
 * Everything the candidate holds that production did not, besides the step
 * targets: new declarations, new values and new asset material. The ordinary
 * policy admits them, so a migration does too, but they are derived from the
 * production-to-candidate diff and listed, never inferred from the declaration.
 */
function candidateAdditions(
  facts: { readonly production: ManagedContractCompatibilityFacts; readonly candidate: ManagedContractCompatibilityFacts },
  production: ManagedSiteContentDocument,
  candidate: ManagedSiteContentDocument,
  targets: ReadonlySet<string>,
): ManagedSiteFieldMigrationAdditionsV1 {
  const productionKeys = new Set(valuesByKey(production).keys());
  return {
    stableIds: [...facts.candidate.declarations.keys()]
      .filter((id) => !facts.production.declarations.has(id) && !targets.has(id))
      .sort(),
    contentValues: candidate.values
      .filter((value) => !targets.has(value.fieldId))
      .filter((value) => !productionKeys.has(contentValueKey(value.fieldId, value.owner)))
      .map((value) => ({ fieldId: value.fieldId, owner: value.owner })),
    assetManifestEntries: candidate.assetManifest.length - production.assetManifest.length,
  };
}

function accountForContent(
  production: ManagedSiteContentDocument,
  candidate: ManagedSiteContentDocument,
  resolution: ManagedSiteFieldMigrationResolutionV1,
  additions: ManagedSiteFieldMigrationAdditionsV1,
): ManagedSiteFieldMigrationAccountingV1 {
  const { unchanged, consumed } = accountForProduction(production, candidate, resolution.retired);
  const targetIds = new Set<string>(resolution.steps.map(({ step }) => step.target));
  const targets = candidate.values.filter((value) => targetIds.has(value.fieldId)).length;
  const added = additions.contentValues.length;
  if (unchanged + targets + added !== candidate.values.length) {
    fail("MIGRATION_UNDECLARED_CHANGE", "Candidate values are not production, targets and listed additions");
  }
  return {
    productionValues: production.values.length,
    unchanged,
    consumed,
    candidateValues: candidate.values.length,
    targets,
    added,
  };
}

function sourceValues(
  resolved: ManagedSiteFieldMigrationResolvedStepV1,
  production: ValuesByKey,
): ValuesByKey {
  return new Map(
    resolved.sources.map((source) => {
      const value = production.get(contentValueKey(source.id, resolved.owner));
      if (value === undefined) {
        return fail("MIGRATION_SOURCE_VALUE_MISSING", `Source ${source.id} has no production value`);
      }
      return [source.id, value];
    }),
  );
}

function asTargetValue(
  resolved: ManagedSiteFieldMigrationResolvedStepV1,
  result: ManagedSiteFieldMigrationResultV1,
): ManagedSiteContentValue {
  const value = {
    fieldId: resolved.target.id,
    owner: resolved.owner,
    type: resolved.target.type,
    value: result.value,
  } as ManagedSiteContentValue;
  try {
    validateParsedManagedFieldValue(resolved.target, value);
  } catch (error) {
    if (!(error instanceof ManagedSiteContractError)) throw error;
    fail("MIGRATION_TARGET_CONSTRAINTS", `Target ${resolved.target.id} does not admit F's value: ${error.code}`);
  }
  return value;
}

function candidateTarget(
  resolved: ManagedSiteFieldMigrationResolvedStepV1,
  candidate: ValuesByKey,
): ManagedSiteContentValue {
  const value = candidate.get(contentValueKey(resolved.target.id, resolved.owner));
  if (value === undefined) {
    return fail("MIGRATION_TARGET_VALUE_MISSING", `Candidate has no value for ${resolved.target.id}`);
  }
  return value;
}

function assertReadBack(
  resolved: ManagedSiteFieldMigrationResolvedStepV1,
  target: ManagedSiteContentValue,
  result: ManagedSiteFieldMigrationResultV1,
  sources: ValuesByKey,
): void {
  const read = readBackManagedSiteFieldMigrationStepV1(target, resolved.step, result.offsets);
  for (const recovered of read) {
    const source = sources.get(recovered.fieldId);
    const expected = source === undefined
      ? undefined
      : joinManagedSiteFieldMigrationRuns(managedSiteFieldMigrationSourceRuns(source));
    if (!canonicalEqual(recovered.runs, expected ?? null)) {
      fail("MIGRATION_READBACK_MISMATCH", `Source ${recovered.fieldId} does not read back with its marks`);
    }
  }
}

function proveStep(
  resolved: ManagedSiteFieldMigrationResolvedStepV1,
  production: ValuesByKey,
  candidate: ValuesByKey,
): ManagedSiteFieldMigrationStepProofV1 {
  const sources = sourceValues(resolved, production);
  const result = applyManagedSiteFieldMigrationStepV1(resolved.step, sources);
  const expected = asTargetValue(resolved, result);
  const actual = candidateTarget(resolved, candidate);
  if (!canonicalEqual(actual, expected)) {
    fail("MIGRATION_TARGET_MISMATCH", `Candidate ${resolved.target.id} is not F of its sources`);
  }
  assertReadBack(resolved, actual, result, sources);
  return managedSiteFieldMigrationStepProof(resolved, result.offsets);
}

function assertSomethingMigrates(
  declaration: ManagedSiteFieldMigrationV1,
  bridge: unknown,
): void {
  if (declaration.steps.length === 0 && bridge === null) {
    fail("MIGRATION_DECLARATION_EMPTY", "A declaration with no step and no bridge change migrates nothing");
  }
}

interface MigrationInputs {
  readonly productionContract: ManagedSiteContractV1;
  readonly productionContent: ManagedSiteContentDocument;
  readonly candidateContract: ManagedSiteContractV1;
  readonly candidateContent: ManagedSiteContentDocument;
}

/** The declaration names these artifacts, and the runtime moves only as declared. */
function assertRuntime(
  inputs: MigrationInputs,
  declaration: ManagedSiteFieldMigrationV1,
  options: ManagedSiteFieldMigrationOptionsV1,
): ManagedSiteFieldMigrationBridgeStepV1 | null {
  assertFrom(declaration, inputs.productionContract, inputs.productionContent);
  validateCompatibilityInputs(inputs.productionContract, inputs.productionContent, inputs.candidateContract);
  assertRuntimeIdentity(inputs.productionContract, inputs.candidateContract);
  const bridge = assertManagedSiteFieldMigrationBridgeV1(
    inputs.productionContract, inputs.candidateContract, declaration, options.admitBridge,
  );
  assertSomethingMigrates(declaration, bridge);
  return bridge;
}

function proveMigration(
  inputs: MigrationInputs,
  declaration: ManagedSiteFieldMigrationV1,
): Pick<ManagedSiteFieldMigrationProofV1, "accounting" | "steps" | "additions" | "added"> {
  const productionFacts = collectManagedContractCompatibilityFacts(inputs.productionContract);
  const candidateFacts = collectManagedContractCompatibilityFacts(inputs.candidateContract);
  const resolution = resolveManagedSiteFieldMigrationStepsV1(productionFacts, candidateFacts, declaration);
  const additions = candidateAdditions(
    { production: productionFacts, candidate: candidateFacts },
    inputs.productionContent, inputs.candidateContent, new Set(declaration.steps.map((step) => step.target)),
  );
  const accounting = accountForContent(inputs.productionContent, inputs.candidateContent, resolution, additions);
  assertManagedContractFactsCompatible(productionFacts, candidateFacts, resolution.retired);
  const outlineEntries = assertManagedSiteFieldMigrationReferencesV1(inputs.productionContract, inputs.candidateContract, resolution.steps);
  const outlines = assertManagedSiteFieldMigrationUrlsV1(inputs, managedSiteFieldMigrationRenames(resolution.steps));
  const production = valuesByKey(inputs.productionContent);
  const candidate = valuesByKey(inputs.candidateContent);
  const steps = resolution.steps.map((resolved) => proveStep(resolved, production, candidate));
  assertManifestPreserved(inputs.productionContent.assetManifest, inputs.candidateContent.assetManifest);
  validateManagedSiteContractV1ContentSemantics(inputs.candidateContract, inputs.candidateContent);
  const added = [
    ...resolution.steps.flatMap(managedSiteFieldMigrationAddedItems),
    ...managedSiteFieldMigrationMoves(inputs.productionContract, inputs.candidateContract, resolution.steps),
    ...outlineEntries,
    ...outlines,
  ];
  return { accounting, steps, additions, added };
}

/**
 * Whether a candidate is production plus exactly the declared migration: the
 * runtime moves at most one admitted bridge version forward, every production
 * value is unchanged or consumed by one step whose target equals F of its
 * sources and reads back to them, and every other compatibility rule holds for
 * everything the migration does not retire. Returns the proof, including every
 * piece of material the migration adds.
 */
export function validateManagedSiteContractV1MigrationCompatibility(
  productionContract: ManagedSiteContractV1,
  productionContent: ManagedSiteContentDocument,
  candidateContract: ManagedSiteContractV1,
  candidateContent: ManagedSiteContentDocument,
  declarationInput: unknown,
  options: ManagedSiteFieldMigrationOptionsV1,
): ManagedSiteFieldMigrationProofV1 {
  const inputs = { productionContract, productionContent, candidateContract, candidateContent };
  const declaration = parseManagedSiteFieldMigrationV1(declarationInput);
  const bridge = assertRuntime(inputs, declaration, options);
  const { accounting, steps, additions, added } = proveMigration(inputs, declaration);
  return parseJsonValue({
    kind: "migrated",
    declarationSha256: sha256Canonical(declaration),
    bridge,
    accounting,
    steps,
    added,
    additions,
  }) as unknown as ManagedSiteFieldMigrationProofV1;
}
