import {
  addManifestEntry,
  emptyManifestIndex,
  manifestEntryAt,
} from "./asset-manifest-index.js";
import { canonicalizeJson } from "./canonical.js";
import type {
  ManagedSiteAssetManifestEntry,
  ManagedSiteContentDocument,
  ManagedSiteContentValue,
} from "./content.js";
import { validateManagedSiteContractV1ContentSemantics } from "./content-semantics.js";
import {
  collectManagedContractCompatibilityFacts,
  type ManagedContractCompatibilityFacts,
} from "./contract-compatibility-facts.js";
import {
  includesAllValues,
  isCompatibilityAssetWidened,
  isCompatibilityCollectionWidened,
  isCompatibilityFieldWidened,
} from "./contract-compatibility-constraints.js";
import {
  assertProductionRedirectsPreserved,
  assertProductionRoutesUnmoved,
  type ManagedSiteRedirectChangeV1,
} from "./contract-compatibility-routes.js";
import { assertProductionH1sKept, type ManagedSiteH1AdoptionV1 } from "./contract-compatibility-h1.js";
import { assertProductionSeoIdentityPreserved } from "./contract-compatibility-seo.js";
import type { ManagedSiteSeoReorderV1 } from "./contract-compatibility-seo-facts.js";
import { withAdmittedEditableSeoRepoints } from "./contract-compatibility-seo-repoint.js";
import type { ManagedSiteContractV1 } from "./contract.js";
import { validateManagedSiteContractV1Semantics } from "./contract-semantics.js";
import { ManagedSiteContractError } from "./errors.js";
import type { StableId } from "./ids.js";

export interface ManagedSiteContractCompatibilityV1 {
  readonly kind: "compatible";
  readonly addedStableIds: readonly StableId[];
  readonly addedContentValueCount: number;
  readonly addedAssetManifestCount: number;
  /** Every production redirect the candidate kept but changed, by path. */
  readonly changedRedirects: readonly ManagedSiteRedirectChangeV1[];
  /** Every production SEO list the candidate kept in another order, by path. */
  readonly reorderedSeo: readonly ManagedSiteSeoReorderV1[];
  /** Every static page with no H1 field in production that declares its H1 now, by page. */
  readonly adoptedH1: readonly ManagedSiteH1AdoptionV1[];
}

/** What a change does to production URLs and SEO that is admitted and listed. */
export interface ManagedUrlAndSeoChanges {
  readonly changedRedirects: readonly ManagedSiteRedirectChangeV1[];
  readonly reorderedSeo: readonly ManagedSiteSeoReorderV1[];
  readonly adoptedH1: readonly ManagedSiteH1AdoptionV1[];
}

function fail(code: string, message: string): never {
  throw new ManagedSiteContractError(code, message);
}

function canonicalEqual(left: unknown, right: unknown): boolean {
  return canonicalizeJson(left) === canonicalizeJson(right);
}

function sameMembers(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return left.length === right.length && includesAllValues(left, right);
}

function scopeKey(scope: { readonly collectionId: string } | "global"): string {
  return scope === "global" ? scope : `collection:${scope.collectionId}`;
}

function assertDeclarations(
  production: ManagedContractCompatibilityFacts,
  candidate: ManagedContractCompatibilityFacts,
  retired: ReadonlySet<string>,
): void {
  for (const [id, declaration] of production.declarations) {
    if (retired.has(id)) continue;
    const next = candidate.declarations.get(id);
    if (
      next === undefined ||
      next.kind !== declaration.kind ||
      scopeKey(next.scope) !== scopeKey(declaration.scope)
    ) {
      fail(
        "COMPATIBILITY_DECLARATION_REMOVED",
        `Stable declaration changed: ${id}`,
      );
    }
  }
}

function assertTombstones(
  production: ManagedContractCompatibilityFacts,
  candidate: ManagedContractCompatibilityFacts,
): void {
  for (const id of production.tombstones) {
    if (!candidate.tombstones.has(id)) {
      fail(
        "COMPATIBILITY_TOMBSTONE_REMOVED",
        `Stable tombstone changed: ${id}`,
      );
    }
  }
}

function assertFields(
  production: ManagedContractCompatibilityFacts,
  candidate: ManagedContractCompatibilityFacts,
  retired: ReadonlySet<string>,
): void {
  for (const [id, field] of production.fields) {
    if (retired.has(id)) continue;
    const next = candidate.fields.get(id);
    if (next === undefined || !isCompatibilityFieldWidened(field, next)) {
      fail(
        "COMPATIBILITY_FIELD_POLICY_NARROWED",
        `Field policy changed: ${id}`,
      );
    }
  }
}

function assertCollections(
  production: ManagedContractCompatibilityFacts,
  candidate: ManagedContractCompatibilityFacts,
): void {
  for (const [id, descriptor] of production.collections) {
    const next = candidate.collections.get(id);
    if (
      next === undefined ||
      !isCompatibilityCollectionWidened(descriptor, next)
    ) {
      fail(
        "COMPATIBILITY_COLLECTION_POLICY_NARROWED",
        `Collection policy changed: ${id}`,
      );
    }
  }
}

function assertAssets(
  production: ManagedContractCompatibilityFacts,
  candidate: ManagedContractCompatibilityFacts,
): void {
  for (const [id, descriptor] of production.assets) {
    const next = candidate.assets.get(id);
    if (next === undefined || !isCompatibilityAssetWidened(descriptor, next)) {
      fail(
        "COMPATIBILITY_ASSET_POLICY_NARROWED",
        `Asset policy changed: ${id}`,
      );
    }
  }
}

function assertAliases(
  production: ManagedContractCompatibilityFacts,
  candidate: ManagedContractCompatibilityFacts,
): void {
  for (const [id, group] of production.aliases) {
    const next = candidate.aliases.get(id);
    if (next === undefined || !sameMembers(group.fieldIds, next.fieldIds)) {
      fail("COMPATIBILITY_ALIAS_CHANGED", `Atomic alias changed: ${id}`);
    }
  }
  for (const [id, group] of candidate.aliases) {
    if (production.aliases.has(id)) continue;
    if (group.fieldIds.some((fieldId) => production.fields.has(fieldId))) {
      fail(
        "COMPATIBILITY_ALIAS_CHANGED",
        `New atomic alias captures a production field: ${id}`,
      );
    }
  }
}

function contentValueKey(value: ManagedSiteContentValue): string {
  return canonicalizeJson({ fieldId: value.fieldId, owner: value.owner });
}

function assertContentPreserved(
  production: ManagedSiteContentDocument,
  candidate: ManagedSiteContentDocument,
): void {
  const candidateValues = new Map(
    candidate.values.map((value) => [contentValueKey(value), value]),
  );
  for (const value of production.values) {
    const next = candidateValues.get(contentValueKey(value));
    if (next === undefined || !canonicalEqual(value, next)) {
      fail(
        "COMPATIBILITY_CONTENT_CHANGED",
        `Production content changed: ${value.fieldId}`,
      );
    }
  }
}

export function assertManifestPreserved(
  production: readonly ManagedSiteAssetManifestEntry[],
  candidate: readonly ManagedSiteAssetManifestEntry[],
): void {
  const candidateEntries = emptyManifestIndex();
  for (const entry of candidate) addManifestEntry(candidateEntries, entry);
  for (const entry of production) {
    const next = manifestEntryAt(candidateEntries, entry.assetSlotId, entry.path);
    if (next === undefined || !canonicalEqual(entry, next)) {
      fail(
        "COMPATIBILITY_ASSET_CHANGED",
        `Production asset material changed: ${entry.assetSlotId} ${entry.path}`,
      );
    }
  }
}

function assertRuntimeIdentity(
  production: ManagedSiteContractV1,
  candidate: ManagedSiteContractV1,
): void {
  if (
    production.contractId !== candidate.contractId ||
    !canonicalEqual(production.adapter, candidate.adapter) ||
    !canonicalEqual(production.bridge, candidate.bridge)
  ) {
    fail(
      "COMPATIBILITY_RUNTIME_CHANGED",
      "Managed-site runtime identity changed",
    );
  }
}

function compatibilityResult(
  production: ManagedContractCompatibilityFacts,
  candidate: ManagedContractCompatibilityFacts,
  productionContent: ManagedSiteContentDocument,
  candidateContent: ManagedSiteContentDocument,
  changes: ManagedUrlAndSeoChanges,
): ManagedSiteContractCompatibilityV1 {
  const addedStableIds = [...candidate.declarations.values()]
    .filter(({ id }) => !production.declarations.has(id))
    .map(({ id }) => id)
    .sort();
  return Object.freeze({
    kind: "compatible",
    addedStableIds: Object.freeze(addedStableIds),
    addedContentValueCount:
      candidateContent.values.length - productionContent.values.length,
    addedAssetManifestCount:
      candidateContent.assetManifest.length -
      productionContent.assetManifest.length,
    changedRedirects: changes.changedRedirects,
    reorderedSeo: changes.reorderedSeo,
    adoptedH1: changes.adoptedH1,
  });
}

/**
 * Every declaration and policy check the compatibility rule makes, except for
 * the ids in `retired`: production fields a declared migration consumes, which
 * the candidate may drop. The ordinary rule passes an empty set, so it checks
 * exactly what it always has, in the same order, with the same errors.
 */
export function assertManagedContractFactsCompatible(
  productionFacts: ManagedContractCompatibilityFacts,
  candidateFacts: ManagedContractCompatibilityFacts,
  retired: ReadonlySet<string>,
): void {
  assertDeclarations(productionFacts, candidateFacts, retired);
  assertTombstones(productionFacts, candidateFacts);
  assertFields(productionFacts, candidateFacts, retired);
  assertCollections(productionFacts, candidateFacts);
  assertAssets(productionFacts, candidateFacts);
  assertAliases(productionFacts, candidateFacts);
}

function assertContractCompatibility(
  productionContract: ManagedSiteContractV1,
  candidateContract: ManagedSiteContractV1,
): readonly [
  ManagedContractCompatibilityFacts,
  ManagedContractCompatibilityFacts,
] {
  assertRuntimeIdentity(productionContract, candidateContract);
  const productionFacts =
    collectManagedContractCompatibilityFacts(productionContract);
  const candidateFacts =
    collectManagedContractCompatibilityFacts(candidateContract);
  assertManagedContractFactsCompatible(productionFacts, candidateFacts, new Set());
  return [productionFacts, candidateFacts];
}

export interface ManagedCompatibilitySides {
  readonly productionContract: ManagedSiteContractV1;
  readonly productionContent: ManagedSiteContentDocument;
  readonly candidateContract: ManagedSiteContractV1;
  readonly candidateContent: ManagedSiteContentDocument;
}

/**
 * A change keeps every production URL and SEO identity fact. `renames` is
 * empty for an ordinary change; a declared migration maps each field it
 * retires to its target. The ordinary policy runs this after every older
 * check, so a candidate those refused is refused with the same code as
 * before. Returns what it admitted and lists: changed redirects, reordered
 * SEO lists and pages that declare their H1 for the first time.
 */
export function assertManagedProductionUrlsAndSeoIdentity(
  sides: ManagedCompatibilitySides,
  renames: ReadonlyMap<string, string>,
): ManagedUrlAndSeoChanges {
  const { productionContract, candidateContract, candidateContent } = sides;
  assertProductionRoutesUnmoved(productionContract, candidateContract);
  const changedRedirects = assertProductionRedirectsPreserved(productionContract, candidateContract, candidateContent);
  const reorderedSeo = assertProductionSeoIdentityPreserved(
    productionContract,
    withAdmittedEditableSeoRepoints(sides),
    renames,
  );
  const adoptedH1 = assertProductionH1sKept(
    { contract: productionContract, content: sides.productionContent },
    { contract: candidateContract, content: candidateContent },
    renames,
  );
  return { changedRedirects, reorderedSeo, adoptedH1 };
}

export function validateCompatibilityInputs(
  productionContract: ManagedSiteContractV1,
  productionContent: ManagedSiteContentDocument,
  candidateContract: ManagedSiteContractV1,
): void {
  validateManagedSiteContractV1ContentSemantics(
    productionContract,
    productionContent,
  );
  validateManagedSiteContractV1Semantics(candidateContract);
}

function assertCandidateContent(
  production: ManagedSiteContentDocument,
  candidateContract: ManagedSiteContractV1,
  candidate: ManagedSiteContentDocument,
): void {
  validateManagedSiteContractV1ContentSemantics(candidateContract, candidate);
  assertContentPreserved(production, candidate);
  assertManifestPreserved(production.assetManifest, candidate.assetManifest);
}

export function validateManagedSiteContractV1Compatibility(
  productionContract: ManagedSiteContractV1,
  productionContent: ManagedSiteContentDocument,
  candidateContract: ManagedSiteContractV1,
  candidateContent: ManagedSiteContentDocument,
): ManagedSiteContractCompatibilityV1 {
  validateCompatibilityInputs(
    productionContract,
    productionContent,
    candidateContract,
  );
  const [productionFacts, candidateFacts] = assertContractCompatibility(
    productionContract,
    candidateContract,
  );
  assertCandidateContent(
    productionContent,
    candidateContract,
    candidateContent,
  );
  const changes = assertManagedProductionUrlsAndSeoIdentity(
    { productionContract, productionContent, candidateContract, candidateContent },
    new Map(),
  );
  return compatibilityResult(productionFacts, candidateFacts, productionContent, candidateContent, changes);
}
