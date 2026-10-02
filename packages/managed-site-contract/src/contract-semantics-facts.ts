import {
  collectManagedSiteContractOccurrences,
  type ManagedSiteContractOccurrence,
} from "./contract-occurrence-registry.js";
import type { ManagedPageRoute, ManagedSiteContractV1 } from "./contract.js";
import { getStableIdKind, type StableId, type StableIdKind } from "./ids.js";
import { parseSourceAddress, type SourceAddress } from "./source.js";

export type ContractFactScope = "global" | { readonly collectionId: StableId<"collection"> };

export interface ManagedSiteContractDeclarationFact {
  readonly id: StableId;
  readonly kind: StableIdKind;
  readonly scope: ContractFactScope;
  readonly location: string;
}

export interface ManagedSiteContractReferenceFact {
  readonly id: StableId;
  readonly expectedKind: StableIdKind;
  readonly expectedScope: ContractFactScope;
  readonly location: string;
}

export interface ManagedSiteContractSourceFact {
  readonly id: StableId;
  readonly owner: "field" | "collection" | "protected";
  readonly address: SourceAddress;
  readonly location: string;
}

export type ManagedSiteContractRouteFact =
  | { readonly kind: "static"; readonly path: string; readonly location: string }
  | { readonly kind: "generated"; readonly path: string; readonly collectionId: StableId<"collection">; readonly routeKeyFieldId: StableId<"field">; readonly location: string }
  | { readonly kind: "redirect"; readonly path: string; readonly location: string };

export interface ManagedSiteContractAliasFact {
  readonly id: StableId<"alias">;
  readonly fieldIds: readonly StableId<"field">[];
  readonly location: string;
}

export interface ManagedSiteContractFacts {
  readonly declarations: readonly ManagedSiteContractDeclarationFact[];
  readonly references: readonly ManagedSiteContractReferenceFact[];
  readonly sources: readonly ManagedSiteContractSourceFact[];
  readonly routes: readonly ManagedSiteContractRouteFact[];
  readonly aliases: readonly ManagedSiteContractAliasFact[];
  readonly tombstones: readonly StableId[];
  readonly deferred: { readonly itemIds: readonly StableId<"item">[] };
}

interface MutableFacts {
  readonly declarations: ManagedSiteContractDeclarationFact[];
  readonly references: ManagedSiteContractReferenceFact[];
  readonly sources: ManagedSiteContractSourceFact[];
  readonly routes: ManagedSiteContractRouteFact[];
  readonly aliases: ManagedSiteContractAliasFact[];
  readonly tombstones: StableId[];
  readonly itemIds: StableId<"item">[];
}

function createFacts(): MutableFacts {
  return { declarations: [], references: [], sources: [], routes: [], aliases: [], tombstones: [], itemIds: [] };
}

function addOccurrence(facts: MutableFacts, occurrence: ManagedSiteContractOccurrence): void {
  switch (occurrence.role) {
    case "declaration":
      facts.declarations.push(Object.freeze({ id: occurrence.id, kind: getStableIdKind(occurrence.id), scope: occurrence.scope, location: occurrence.location }));
      return;
    case "reference":
      facts.references.push(Object.freeze({ id: occurrence.id, expectedKind: occurrence.idKind, expectedScope: occurrence.scope, location: occurrence.location }));
      return;
    case "deferred":
      facts.itemIds.push(occurrence.id as StableId<"item">);
      return;
    case "tombstone":
      facts.tombstones.push(occurrence.id);
      return;
    default:
      return assertNever(occurrence);
  }
}

function addSource(
  facts: MutableFacts,
  id: StableId,
  resolver: { readonly path: string; readonly pointer: string },
  location: string,
  owner: ManagedSiteContractSourceFact["owner"],
): void {
  facts.sources.push(Object.freeze({ id, owner, address: parseSourceAddress(resolver), location }));
}

function addRoute(facts: MutableFacts, route: ManagedPageRoute, location: string): void {
  switch (route.kind) {
    case "static":
      facts.routes.push(Object.freeze({ kind: "static", path: route.path, location }));
      return;
    case "generated":
      facts.routes.push(Object.freeze({ kind: "generated", path: route.pattern, collectionId: route.collectionId, routeKeyFieldId: route.routeKeyFieldId, location }));
      return;
    default:
      return assertNever(route);
  }
}

function addSectionSources(facts: MutableFacts, sections: ManagedSiteContractV1["pages"][number]["sections"], pageLocation: string): void {
  for (const [sectionIndex, section] of sections.entries()) {
    const sectionLocation = `${pageLocation}.sections[${sectionIndex}]`;
    for (const [fieldIndex, field] of section.fields.entries()) {
      addSource(facts, field.id, field.resolver, `${sectionLocation}.fields[${fieldIndex}].resolver`, "field");
    }
  }
}

function addPageFacts(facts: MutableFacts, contract: ManagedSiteContractV1): void {
  for (const [pageIndex, page] of contract.pages.entries()) {
    const pageLocation = `pages[${pageIndex}]`;
    addRoute(facts, page.route, `${pageLocation}.route`);
    addSectionSources(facts, page.sections, pageLocation);
  }
}

function addCollectionFacts(facts: MutableFacts, contract: ManagedSiteContractV1): void {
  for (const [index, collection] of contract.collections.entries()) {
    addSource(facts, collection.id, collection.resolver, `collections[${index}].resolver`, "collection");
  }
}

function addSeoFacts(facts: MutableFacts, contract: ManagedSiteContractV1): void {
  for (const [index, field] of contract.internalSeo.protectedFields.entries()) {
    addSource(facts, field.id, field.resolver, `internalSeo.protectedFields[${index}].resolver`, "protected");
  }
  for (const [index, redirect] of contract.internalSeo.redirects.entries()) {
    facts.routes.push(Object.freeze({ kind: "redirect", path: redirect.fromPath, location: `internalSeo.redirects[${index}]` }));
  }
}

function addAliasFacts(facts: MutableFacts, contract: ManagedSiteContractV1): void {
  for (const [index, group] of contract.atomicAliasGroups.entries()) {
    facts.aliases.push(Object.freeze({ id: group.id, fieldIds: Object.freeze([...group.fieldIds]), location: `atomicAliasGroups[${index}]` }));
  }
}

function freezeFacts(facts: MutableFacts): ManagedSiteContractFacts {
  return Object.freeze({ declarations: Object.freeze(facts.declarations), references: Object.freeze(facts.references), sources: Object.freeze(facts.sources), routes: Object.freeze(facts.routes), aliases: Object.freeze(facts.aliases), tombstones: Object.freeze(facts.tombstones), deferred: Object.freeze({ itemIds: Object.freeze(facts.itemIds) }) });
}

function assertNever(value: never): never {
  throw new Error(`Unhandled managed-site contract variant: ${JSON.stringify(value)}`);
}

export function collectManagedSiteContractV1Facts(contract: ManagedSiteContractV1): ManagedSiteContractFacts {
  const facts = createFacts();
  for (const occurrence of collectManagedSiteContractOccurrences(contract)) addOccurrence(facts, occurrence);
  addPageFacts(facts, contract);
  addCollectionFacts(facts, contract);
  addSeoFacts(facts, contract);
  addAliasFacts(facts, contract);
  return freezeFacts(facts);
}
