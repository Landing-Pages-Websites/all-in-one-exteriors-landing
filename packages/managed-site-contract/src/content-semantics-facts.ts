import type {
  ManagedContentOwner,
  ManagedSiteContentDocument,
  ManagedSiteContentValue,
} from "./content.js";
import type {
  ManagedPageDescriptor,
  ManagedSiteContractV1,
} from "./contract.js";
import { ManagedSiteContractError } from "./errors.js";
import type {
  ManagedCollectionDescriptor,
  ManagedCollectionItemField,
  ManagedFieldDescriptor,
} from "./fields.js";
import { getStableIdKind, type StableIdKind } from "./ids.js";
import type { ManagedInternalProtectedField } from "./seo.js";
import type { ManagedAssetSlotDescriptor } from "./values.js";

export type ManagedNonItemField =
  | ManagedFieldDescriptor
  | ManagedInternalProtectedField;

export interface ManagedItemFieldFact {
  readonly collection: ManagedCollectionDescriptor;
  readonly descriptor: ManagedCollectionItemField;
}

export type ManagedResolvedContentValue =
  | {
      readonly kind: "field";
      readonly descriptor: ManagedFieldDescriptor;
      readonly value: ManagedSiteContentValue;
      readonly key: string;
    }
  | {
      readonly kind: "protected";
      readonly descriptor: ManagedInternalProtectedField;
      readonly value: ManagedSiteContentValue;
      readonly key: string;
    }
  | {
      readonly kind: "collection_item";
      readonly collection: ManagedCollectionDescriptor;
      readonly descriptor: ManagedCollectionItemField;
      readonly value: ManagedSiteContentValue;
      readonly key: string;
    };

export interface ManagedContentSemanticFacts {
  readonly contract: ManagedSiteContractV1;
  readonly content: ManagedSiteContentDocument;
  readonly pages: ReadonlyMap<string, ManagedPageDescriptor>;
  readonly collections: ReadonlyMap<string, ManagedCollectionDescriptor>;
  readonly assets: ReadonlyMap<string, ManagedAssetSlotDescriptor>;
  readonly nonItemFields: readonly ManagedNonItemField[];
  readonly itemFields: ReadonlyMap<string, ManagedItemFieldFact>;
  readonly resolvedValues: readonly ManagedResolvedContentValue[];
  readonly valuesByKey: ReadonlyMap<string, ManagedResolvedContentValue>;
  readonly referencedAssetIds: ReadonlySet<string>;
  readonly tombstones: ReadonlySet<string>;
  readonly contractIdKindsBySuffix: ReadonlyMap<string, StableIdKind>;
}

interface MutableContractIndexes {
  readonly pages: Map<string, ManagedPageDescriptor>;
  readonly collections: Map<string, ManagedCollectionDescriptor>;
  readonly assets: Map<string, ManagedAssetSlotDescriptor>;
  readonly nonItemFields: ManagedNonItemField[];
  readonly nonItemFieldsById: Map<string, ManagedNonItemField>;
  readonly itemFields: Map<string, ManagedItemFieldFact>;
  readonly referencedAssetIds: Set<string>;
  readonly tombstones: Set<string>;
  readonly contractIdKindsBySuffix: Map<string, StableIdKind>;
}

export function contentSemanticFail(code: string, message: string): never {
  throw new ManagedSiteContractError(code, message);
}

function stableSuffix(id: string): string {
  return id.slice(id.indexOf("_") + 1);
}

function addContractId(indexes: MutableContractIndexes, id: string): void {
  indexes.contractIdKindsBySuffix.set(stableSuffix(id), getStableIdKind(id));
}

function createIndexes(contract: ManagedSiteContractV1): MutableContractIndexes {
  const indexes: MutableContractIndexes = {
    pages: new Map(),
    collections: new Map(),
    assets: new Map(),
    nonItemFields: [],
    nonItemFieldsById: new Map(),
    itemFields: new Map(),
    referencedAssetIds: new Set(),
    tombstones: new Set(contract.tombstonedIds),
    contractIdKindsBySuffix: new Map(),
  };
  addContractId(indexes, contract.contractId);
  return indexes;
}

function addNonItemField(
  indexes: MutableContractIndexes,
  field: ManagedNonItemField,
): void {
  indexes.nonItemFields.push(field);
  indexes.nonItemFieldsById.set(field.id, field);
  addContractId(indexes, field.id);
  if (field.type === "image") indexes.referencedAssetIds.add(field.assetSlotId);
}

function addPageIndexes(
  indexes: MutableContractIndexes,
  contract: ManagedSiteContractV1,
): void {
  for (const page of contract.pages) {
    indexes.pages.set(page.id, page);
    addContractId(indexes, page.id);
    for (const section of page.sections) {
      addContractId(indexes, section.id);
      for (const field of section.fields) addNonItemField(indexes, field);
    }
  }
}

function addCollectionIndexes(
  indexes: MutableContractIndexes,
  contract: ManagedSiteContractV1,
): void {
  for (const collection of contract.collections) {
    indexes.collections.set(collection.id, collection);
    addContractId(indexes, collection.id);
    for (const descriptor of collection.itemFields) {
      indexes.itemFields.set(descriptor.id, { collection, descriptor });
      addContractId(indexes, descriptor.id);
      if (descriptor.type === "image") {
        indexes.referencedAssetIds.add(descriptor.assetSlotId);
      }
    }
  }
}

function addAssetIndexes(
  indexes: MutableContractIndexes,
  contract: ManagedSiteContractV1,
): void {
  for (const asset of contract.assets) {
    indexes.assets.set(asset.id, asset);
    addContractId(indexes, asset.id);
  }
}

function addSeoIndexes(
  indexes: MutableContractIndexes,
  contract: ManagedSiteContractV1,
): void {
  for (const field of contract.internalSeo.protectedFields) {
    addNonItemField(indexes, field);
  }
  for (const page of contract.internalSeo.pages) {
    if (page.metadata.social.image !== null) {
      indexes.referencedAssetIds.add(page.metadata.social.image);
    }
    if (page.primaryImageAssetSlotId !== null) {
      indexes.referencedAssetIds.add(page.primaryImageAssetSlotId);
    }
  }
}

function completeContractIndexes(
  indexes: MutableContractIndexes,
  contract: ManagedSiteContractV1,
): void {
  for (const group of contract.atomicAliasGroups) addContractId(indexes, group.id);
  for (const id of contract.tombstonedIds) addContractId(indexes, id);
}

export function ownerKey(owner: ManagedContentOwner): string {
  switch (owner.kind) {
    case "site":
      return "site";
    case "page":
      return `page:${owner.pageId}`;
    case "collection_item":
      return `item:${owner.collectionId}:${owner.itemId}`;
  }
}

export function contentValueKey(
  fieldId: string,
  owner: ManagedContentOwner,
): string {
  return `${fieldId}|${ownerKey(owner)}`;
}

export function requiredOwner(field: ManagedNonItemField): ManagedContentOwner {
  if (field.scope === "site") return { kind: "site" };
  const pageId = field.usages[0]?.pageId;
  if (pageId === undefined) {
    return contentSemanticFail(
      "CONTENT_OWNER_SCOPE",
      `Page-scoped field ${field.id} has no page usage`,
    );
  }
  return { kind: "page", pageId };
}

function sameOwner(actual: ManagedContentOwner, expected: ManagedContentOwner): boolean {
  return ownerKey(actual) === ownerKey(expected);
}

function failUnresolvedField(indexes: MutableContractIndexes, fieldId: string): never {
  if (indexes.tombstones.has(fieldId)) {
    return contentSemanticFail(
      "CONTENT_FIELD_TOMBSTONED",
      `Content value resolves to tombstoned field ${fieldId}`,
    );
  }
  const suffixKind = indexes.contractIdKindsBySuffix.get(stableSuffix(fieldId));
  if (suffixKind !== undefined && suffixKind !== "field") {
    return contentSemanticFail(
      "CONTENT_ID_CROSS_KIND_COLLISION",
      `Content field reuses ${suffixKind} identity entropy`,
    );
  }
  return contentSemanticFail(
    "CONTENT_FIELD_UNRESOLVED",
    `Content value does not resolve to a live field: ${fieldId}`,
  );
}

function resolveNonItemValue(
  field: ManagedNonItemField,
  value: ManagedSiteContentValue,
): ManagedResolvedContentValue {
  const expectedOwner = requiredOwner(field);
  if (!sameOwner(value.owner, expectedOwner)) {
    return contentSemanticFail(
      "CONTENT_OWNER_SCOPE",
      `Content owner conflicts with field ${field.id}`,
    );
  }
  const key = contentValueKey(field.id, value.owner);
  if (field.type === "internal_protected") {
    return { kind: "protected", descriptor: field, value, key };
  }
  return { kind: "field", descriptor: field, value, key };
}

function resolveItemValue(
  itemField: ManagedItemFieldFact,
  value: ManagedSiteContentValue,
): ManagedResolvedContentValue {
  if (
    value.owner.kind !== "collection_item" ||
    value.owner.collectionId !== itemField.collection.id
  ) {
    return contentSemanticFail(
      "CONTENT_OWNER_SCOPE",
      `Content owner conflicts with item field ${itemField.descriptor.id}`,
    );
  }
  return {
    kind: "collection_item",
    collection: itemField.collection,
    descriptor: itemField.descriptor,
    value,
    key: contentValueKey(itemField.descriptor.id, value.owner),
  };
}

function resolveValue(
  indexes: MutableContractIndexes,
  value: ManagedSiteContentValue,
): ManagedResolvedContentValue {
  const field = indexes.nonItemFieldsById.get(value.fieldId);
  if (field !== undefined) return resolveNonItemValue(field, value);
  const itemField = indexes.itemFields.get(value.fieldId);
  if (itemField !== undefined) return resolveItemValue(itemField, value);
  return failUnresolvedField(indexes, value.fieldId);
}

function resolveValues(
  indexes: MutableContractIndexes,
  content: ManagedSiteContentDocument,
): {
  readonly resolvedValues: readonly ManagedResolvedContentValue[];
  readonly valuesByKey: ReadonlyMap<string, ManagedResolvedContentValue>;
} {
  const resolvedValues: ManagedResolvedContentValue[] = [];
  const valuesByKey = new Map<string, ManagedResolvedContentValue>();
  for (const value of content.values) {
    const resolved = resolveValue(indexes, value);
    if (valuesByKey.has(resolved.key)) {
      contentSemanticFail(
        "CONTENT_VALUE_DUPLICATE",
        `Content value repeats ${resolved.key}`,
      );
    }
    valuesByKey.set(resolved.key, resolved);
    resolvedValues.push(resolved);
  }
  return { resolvedValues, valuesByKey };
}

function assertRequiredNonItemValues(
  indexes: MutableContractIndexes,
  valuesByKey: ReadonlyMap<string, ManagedResolvedContentValue>,
): void {
  for (const field of indexes.nonItemFields) {
    const key = contentValueKey(field.id, requiredOwner(field));
    if (!valuesByKey.has(key)) {
      contentSemanticFail(
        "CONTENT_VALUE_MISSING",
        `Content document is missing field ${field.id}`,
      );
    }
  }
}

export function collectManagedContentSemanticFacts(
  contract: ManagedSiteContractV1,
  content: ManagedSiteContentDocument,
): ManagedContentSemanticFacts {
  const indexes = createIndexes(contract);
  addPageIndexes(indexes, contract);
  addCollectionIndexes(indexes, contract);
  addAssetIndexes(indexes, contract);
  addSeoIndexes(indexes, contract);
  completeContractIndexes(indexes, contract);
  const resolved = resolveValues(indexes, content);
  assertRequiredNonItemValues(indexes, resolved.valuesByKey);
  return {
    contract,
    content,
    pages: indexes.pages,
    collections: indexes.collections,
    assets: indexes.assets,
    nonItemFields: indexes.nonItemFields,
    itemFields: indexes.itemFields,
    resolvedValues: resolved.resolvedValues,
    valuesByKey: resolved.valuesByKey,
    referencedAssetIds: indexes.referencedAssetIds,
    tombstones: indexes.tombstones,
    contractIdKindsBySuffix: indexes.contractIdKindsBySuffix,
  };
}
