import type { ManagedContentOwner } from "./content.js";
import { ManagedSiteContractError } from "./errors.js";
import type { ManagedCollectionDescriptor } from "./fields.js";
import { parseStableId, type StableId } from "./ids.js";
import type { JsonValue } from "./json.js";
import { parseJsonPointer } from "./source.js";
import {
  ManagedSiteSourceResolver,
  type ProjectedSourceLocation,
} from "./source-documents.js";
import {
  ProjectedAssetManifest,
  projectCollectionItemValue,
} from "./source-projection-values.js";

type RawContentValue = Readonly<Record<string, unknown>>;

function fail(code: string, message: string): never {
  throw new ManagedSiteContractError(code, message);
}

function pointersOverlap(
  left: readonly string[],
  right: readonly string[],
): boolean {
  const shorter = left.length <= right.length ? left : right;
  const longer = shorter === left ? right : left;
  return shorter.every((token, index) => token === longer[index]);
}

function assertCollectionPointers(collection: ManagedCollectionDescriptor): void {
  const pointers = [
    parseJsonPointer(collection.itemIdPointer).tokens,
    ...collection.itemFields.map(
      ({ itemPointer }) => parseJsonPointer(itemPointer).tokens,
    ),
  ];
  for (const [index, pointer] of pointers.entries()) {
    for (const other of pointers.slice(index + 1)) {
      if (pointersOverlap(pointer, other)) {
        fail(
          "SOURCE_COLLECTION_POINTER_OVERLAP",
          "Collection source pointers cannot overlap",
        );
      }
    }
  }
}

export function validateCollectionSourcePointers(
  collections: readonly ManagedCollectionDescriptor[],
): void {
  for (const collection of collections) assertCollectionPointers(collection);
}

function assertItemObject(value: JsonValue): void {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail("SOURCE_COLLECTION_ITEM_INVALID", "Collection items must be objects");
  }
}

function parseItemId(value: JsonValue): StableId<"item"> {
  if (typeof value !== "string") {
    return fail(
      "SOURCE_COLLECTION_ITEM_ID",
      "Collection item identity is invalid",
    );
  }
  try {
    return parseStableId(value, "item");
  } catch {
    return fail(
      "SOURCE_COLLECTION_ITEM_ID",
      "Collection item identity is invalid",
    );
  }
}

function itemOwner(
  collection: ManagedCollectionDescriptor,
  itemId: StableId<"item">,
): ManagedContentOwner {
  return { kind: "collection_item", collectionId: collection.id, itemId };
}

function projectItemValues(
  collection: ManagedCollectionDescriptor,
  item: ProjectedSourceLocation,
  sources: ManagedSiteSourceResolver,
  manifest: ProjectedAssetManifest,
): readonly RawContentValue[] {
  assertItemObject(item.value);
  const itemId = parseItemId(
    sources.resolveRelative(item, collection.itemIdPointer).value,
  );
  const owner = itemOwner(collection, itemId);
  return collection.itemFields.map((field) => {
    const source = sources.resolveRelative(item, field.itemPointer);
    return projectCollectionItemValue(field, owner, source.value, manifest);
  });
}

function projectCollection(
  collection: ManagedCollectionDescriptor,
  sources: ManagedSiteSourceResolver,
  manifest: ProjectedAssetManifest,
): readonly RawContentValue[] {
  const source = sources.resolve(collection.resolver, "structure");
  if (!Array.isArray(source.value)) {
    return fail(
      "SOURCE_COLLECTION_NOT_ARRAY",
      "Collection source must be an array",
    );
  }
  return source.value.flatMap((_, index) =>
    projectItemValues(
      collection,
      sources.resolveIndex(source, index),
      sources,
      manifest,
    ),
  );
}

export function projectCollectionValues(
  collections: readonly ManagedCollectionDescriptor[],
  sources: ManagedSiteSourceResolver,
  manifest: ProjectedAssetManifest,
): readonly RawContentValue[] {
  return collections.flatMap((collection) =>
    projectCollection(collection, sources, manifest),
  );
}
