import { ManagedSiteContractError } from "./errors.js";
import { getStableIdKind, type StableId, type StableIdKind } from "./ids.js";
import type {
  ContractFactScope,
  ManagedSiteContractDeclarationFact,
  ManagedSiteContractFacts,
} from "./contract-semantics-facts.js";

interface DeclarationIndex {
  readonly live: ReadonlyMap<string, ManagedSiteContractDeclarationFact>;
  readonly tombstones: ReadonlySet<string>;
}

interface StableIdRegistry {
  readonly ids: Set<string>;
  readonly suffixKinds: Map<string, StableIdKind>;
}

function fail(code: string, message: string): never {
  throw new ManagedSiteContractError(code, message);
}

function stableSuffix(id: StableId): string {
  return id.slice(id.indexOf("_") + 1);
}

function assertUniqueId(id: StableId, registry: StableIdRegistry, duplicateCode: string): void {
  if (registry.ids.has(id)) fail(duplicateCode, `Duplicate stable ID: ${id}`);
  const suffix = stableSuffix(id);
  const kind = getStableIdKind(id);
  const priorKind = registry.suffixKinds.get(suffix);
  if (priorKind !== undefined && priorKind !== kind) fail("CONTRACT_ID_CROSS_KIND_COLLISION", `Cross-kind stable ID collision: ${id}`);
  registry.ids.add(id);
  registry.suffixKinds.set(suffix, kind);
}

function indexLive(declarations: readonly ManagedSiteContractDeclarationFact[], registry: StableIdRegistry): Map<string, ManagedSiteContractDeclarationFact> {
  const live = new Map<string, ManagedSiteContractDeclarationFact>();
  for (const declaration of declarations) {
    assertUniqueId(declaration.id, registry, "CONTRACT_ID_DUPLICATE");
    live.set(declaration.id, declaration);
  }
  return live;
}

function indexTombstones(tombstones: readonly StableId[], live: ReadonlyMap<string, ManagedSiteContractDeclarationFact>, registry: StableIdRegistry): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const id of tombstones) {
    if (live.has(id)) fail("CONTRACT_ID_TOMBSTONED", `Live declaration is tombstoned: ${id}`);
    assertUniqueId(id, registry, "CONTRACT_TOMBSTONE_DUPLICATE");
    ids.add(id);
  }
  return ids;
}

function scopesMatch(actual: ContractFactScope, expected: ContractFactScope): boolean {
  if (actual === "global" || expected === "global") return actual === expected;
  return actual.collectionId === expected.collectionId;
}

function validateReferences(facts: ManagedSiteContractFacts, index: DeclarationIndex): void {
  for (const reference of facts.references) {
    if (getStableIdKind(reference.id) !== reference.expectedKind) fail("CONTRACT_REFERENCE_KIND", `Reference has wrong stable ID kind at ${reference.location}`);
    const declaration = index.live.get(reference.id);
    if (declaration === undefined) validateMissingReference(reference.id, reference.location, index.tombstones);
    if (declaration !== undefined && !scopesMatch(declaration.scope, reference.expectedScope)) fail("CONTRACT_REFERENCE_SCOPE", `Reference has invalid scope at ${reference.location}`);
  }
}

function validateMissingReference(id: StableId, location: string, tombstones: ReadonlySet<string>): never {
  if (tombstones.has(id)) fail("CONTRACT_REFERENCE_TOMBSTONED", `Reference resolves to tombstone at ${location}`);
  return fail("CONTRACT_REFERENCE_UNRESOLVED", `Reference does not resolve at ${location}`);
}

function validateAliases(facts: ManagedSiteContractFacts): void {
  const assignedFields = new Set<string>();
  for (const alias of facts.aliases) {
    const localFields = new Set<string>();
    for (const fieldId of alias.fieldIds) {
      if (localFields.has(fieldId)) fail("CONTRACT_ALIAS_FIELD_DUPLICATE", `Alias group repeats a field at ${alias.location}`);
      if (assignedFields.has(fieldId)) fail("CONTRACT_ALIAS_FIELD_OVERLAP", `Alias groups overlap at ${alias.location}`);
      localFields.add(fieldId);
      assignedFields.add(fieldId);
    }
  }
}

export function validateManagedSiteContractIdentityFacts(facts: ManagedSiteContractFacts): void {
  const registry = { ids: new Set<string>(), suffixKinds: new Map<string, StableIdKind>() };
  const live = indexLive(facts.declarations, registry);
  const index = { live, tombstones: indexTombstones(facts.tombstones, live, registry) };
  validateReferences(facts, index);
  validateAliases(facts);
}
