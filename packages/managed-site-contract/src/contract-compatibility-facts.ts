import {
  collectManagedSiteContractV1Facts,
  type ManagedSiteContractDeclarationFact,
} from "./contract-semantics-facts.js";
import type {
  ManagedAtomicAliasGroup,
  ManagedSiteContractV1,
} from "./contract.js";
import type {
  ManagedCollectionDescriptor,
  ManagedCollectionItemField,
  ManagedFieldDescriptor,
} from "./fields.js";
import type { ManagedInternalProtectedField } from "./seo.js";
import type { ManagedAssetSlotDescriptor } from "./values.js";

export type ManagedCompatibilityFieldFact =
  | Readonly<{ kind: "rendered"; descriptor: ManagedFieldDescriptor }>
  | Readonly<{ kind: "item"; descriptor: ManagedCollectionItemField }>
  | Readonly<{ kind: "protected"; descriptor: ManagedInternalProtectedField }>;

export interface ManagedContractCompatibilityFacts {
  readonly declarations: ReadonlyMap<
    string,
    ManagedSiteContractDeclarationFact
  >;
  readonly fields: ReadonlyMap<string, ManagedCompatibilityFieldFact>;
  readonly collections: ReadonlyMap<string, ManagedCollectionDescriptor>;
  readonly assets: ReadonlyMap<string, ManagedAssetSlotDescriptor>;
  readonly aliases: ReadonlyMap<string, ManagedAtomicAliasGroup>;
  readonly tombstones: ReadonlySet<string>;
}

function addRenderedFields(
  contract: ManagedSiteContractV1,
  fields: Map<string, ManagedCompatibilityFieldFact>,
): void {
  for (const page of contract.pages) {
    for (const section of page.sections) {
      for (const descriptor of section.fields) {
        fields.set(
          descriptor.id,
          Object.freeze({ kind: "rendered", descriptor }),
        );
      }
    }
  }
}

function addCollectionFacts(
  contract: ManagedSiteContractV1,
  fields: Map<string, ManagedCompatibilityFieldFact>,
  collections: Map<string, ManagedCollectionDescriptor>,
): void {
  for (const collection of contract.collections) {
    collections.set(collection.id, collection);
    for (const descriptor of collection.itemFields) {
      fields.set(descriptor.id, Object.freeze({ kind: "item", descriptor }));
    }
  }
}

function addProtectedFields(
  contract: ManagedSiteContractV1,
  fields: Map<string, ManagedCompatibilityFieldFact>,
): void {
  for (const descriptor of contract.internalSeo.protectedFields) {
    fields.set(descriptor.id, Object.freeze({ kind: "protected", descriptor }));
  }
}

export function collectManagedContractCompatibilityFacts(
  contract: ManagedSiteContractV1,
): ManagedContractCompatibilityFacts {
  const semanticFacts = collectManagedSiteContractV1Facts(contract);
  const fields = new Map<string, ManagedCompatibilityFieldFact>();
  const collections = new Map<string, ManagedCollectionDescriptor>();
  addRenderedFields(contract, fields);
  addCollectionFacts(contract, fields, collections);
  addProtectedFields(contract, fields);
  return Object.freeze({
    declarations: new Map(
      semanticFacts.declarations.map((fact) => [fact.id, fact]),
    ),
    fields,
    collections,
    assets: new Map(
      contract.assets.map((descriptor) => [descriptor.id, descriptor]),
    ),
    aliases: new Map(
      contract.atomicAliasGroups.map((group) => [group.id, group]),
    ),
    tombstones: new Set(contract.tombstonedIds),
  });
}
