import type {
  JsonValue,
  ManagedSiteAssetManifestEntry,
  ManagedSiteContentValue,
  StableId,
} from "@landing-pages-websites/managed-site-contract";

import { renderAnchor } from "./anchors.js";
import type { Candidate, CollectionCandidate, RawDestination } from "./candidates.js";
import type { FieldBinding, PageBinding } from "./bindings.js";
import type { ContractParts } from "./emit-contract.js";
import type { ConversionConfig } from "./config.js";
import { assetRepositoryPath } from "./paths.js";
import { probeImage } from "./image-probe.js";
import { cloneJson, isJsonObject, writeAtPointer, type JsonObject } from "./json-write.js";
import { offSiteDestination } from "./destinations.js";

/**
 * Content emission is a pure restatement of what the source already renders.
 * Nothing is invented here: every value is a literal the walker read, and the
 * source JSON documents are written so their pointers match the resolvers.
 */

export interface ContentEmission {
  readonly values: readonly ManagedSiteContentValue[];
  readonly assetManifest: readonly ManagedSiteAssetManifestEntry[];
  readonly sourceDocuments: ReadonlyMap<string, JsonValue>;
}

type MutableRecord = JsonObject;

function setPointer(root: JsonObject, pointer: string, value: JsonValue): void {
  writeAtPointer(root, pointer, cloneJson(value));
}

function destinationValue(
  destination: RawDestination,
  pageId: StableId<"page">,
): JsonValue {
  switch (destination.kind) {
    case "self":
      return { kind: "internal", pageId, fragment: null };
    case "fragment":
      return { kind: "internal", pageId, fragment: destination.fragment };
    case "external":
    case "email":
    case "phone":
      return offSiteDestination(destination);
  }
}

interface ContentContext {
  readonly config: ConversionConfig;
  readonly repositoryRoot: string;
  readonly parts: ContractParts;
  readonly pagesById: ReadonlyMap<string, PageBinding>;
}

function imageValueFor(
  source: string,
  altText: string | null,
  context: ContentContext,
): JsonValue | null {
  const repositoryPath = assetRepositoryPath(context.config.assetRoot, source);
  if (repositoryPath === null) return null;
  const probed = probeImage(`${context.repositoryRoot}/${repositoryPath}`);
  if (probed === null) return null;
  return {
    path: repositoryPath,
    sha256: probed.sha256,
    mimeType: probed.mimeType,
    width: probed.width,
    height: probed.height,
    bytes: probed.bytes,
    altText,
    crop: null,
    focalPoint: null,
  };
}

function ownerFor(binding: FieldBinding): JsonValue {
  if (binding.scope === "site") return { kind: "site" };
  const pageId = binding.pageIds[0];
  if (pageId === undefined) throw new Error("A page-scoped field must belong to a page");
  return { kind: "page", pageId };
}

function manifestEntryFor(
  assetSlotId: StableId<"asset"> | undefined,
  value: JsonValue,
): ManagedSiteAssetManifestEntry | null {
  if (assetSlotId === undefined || !isImageShaped(value)) return null;
  return {
    assetSlotId,
    path: value.path,
    sha256: value.sha256,
    mimeType: value.mimeType,
    width: value.width,
    height: value.height,
    bytes: value.bytes,
  } as ManagedSiteAssetManifestEntry;
}

function simpleValueFor(
  candidate: Candidate,
  binding: FieldBinding,
  context: ContentContext,
): { readonly type: string; readonly value: JsonValue } | null {
  switch (candidate.kind) {
    case "plain_text":
      return { type: "plain_text", value: candidate.value };
    case "heading_text":
      return { type: "heading_text", value: candidate.value };
    case "rich_text":
      return { type: "rich_text", value: candidate.document as unknown as JsonValue };
    case "link": {
      const pageId = binding.pageIds[0];
      if (pageId === undefined) return null;
      return {
        type: "link",
        value: {
          label: candidate.label,
          destination: destinationValue(candidate.destination, pageId),
          target: candidate.newWindow ? "new_window" : "same_window",
        },
      };
    }
    case "image": {
      const value = imageValueFor(candidate.source, candidate.altText, context);
      return value === null ? null : { type: "image", value };
    }
    case "collection":
      return null;
  }
}

function collectionOrderValue(candidate: CollectionCandidate, context: ContentContext): JsonValue {
  const itemIds = context.parts.itemIdsByAnchor.get(renderAnchor(candidate.anchor)) ?? [];
  return { orderedItemIds: [...itemIds] };
}

function itemValuesFor(
  candidate: CollectionCandidate,
  context: ContentContext,
): {
  readonly values: readonly ManagedSiteContentValue[];
  readonly documents: readonly MutableRecord[];
  readonly manifest: readonly ManagedSiteAssetManifestEntry[];
} {
  const anchorKey = renderAnchor(candidate.anchor);
  const collectionId = context.parts.collectionIdByAnchor.get(anchorKey);
  const itemIds = context.parts.itemIdsByAnchor.get(anchorKey) ?? [];
  const fieldIds = context.parts.itemFieldIdsByAnchor.get(anchorKey);
  if (collectionId === undefined || fieldIds === undefined) {
    return { values: [], documents: [], manifest: [] };
  }

  const values: ManagedSiteContentValue[] = [];
  const documents: MutableRecord[] = [];
  const manifest: ManagedSiteAssetManifestEntry[] = [];
  for (const [index, item] of candidate.items.entries()) {
    const itemId = itemIds[index];
    if (itemId === undefined) continue;
    const document: MutableRecord = { id: itemId };
    for (const entry of item) {
      const spec = candidate.itemFields.find((field) => field.property === entry.property);
      const fieldId = fieldIds.get(entry.property);
      if (spec === undefined || fieldId === undefined) continue;
      const value =
        spec.kind === "image"
          ? imageValueFor(entry.value, entry.altText, context)
          : entry.value;
      if (value === null) continue;
      if (spec.kind === "image") {
        const slotId = context.parts.assetSlotByAnchor.get(`${anchorKey}/prop:${spec.property}`);
        const entryForSlot = manifestEntryFor(slotId, value);
        if (entryForSlot !== null) manifest.push(entryForSlot);
      }
      document[entry.property] = value;
      values.push({
        fieldId,
        owner: { kind: "collection_item", collectionId, itemId },
        type: spec.kind,
        value,
      } as ManagedSiteContentValue);
    }
    documents.push(document);
  }
  return { values, documents, manifest };
}

export function emitContent(
  bindings: readonly FieldBinding[],
  context: ContentContext,
): ContentEmission {
  const values: ManagedSiteContentValue[] = [];
  const documents = new Map<string, MutableRecord>();
  const manifest: ManagedSiteAssetManifestEntry[] = [];

  const documentFor = (path: string): MutableRecord => {
    const existing = documents.get(path);
    if (existing !== undefined) return existing;
    const created: MutableRecord = {};
    documents.set(path, created);
    return created;
  };

  for (const binding of bindings) {
    const candidate = binding.candidate;
    if (candidate.kind === "collection") {
      const order = collectionOrderValue(candidate, context);
      setPointer(documentFor(binding.sourcePath), `${binding.pointer}/order`, order);
      const items = itemValuesFor(candidate, context);
      setPointer(documentFor(binding.sourcePath), `${binding.pointer}/items`, [...items.documents]);
      values.push({
        fieldId: binding.fieldId,
        owner: ownerFor(binding),
        type: "collection",
        value: order,
      } as ManagedSiteContentValue);
      values.push(...items.values);
      manifest.push(...items.manifest);
      continue;
    }
    const simple = simpleValueFor(candidate, binding, context);
    if (simple === null) continue;
    if (candidate.kind === "image") {
      const slotId = context.parts.assetSlotByAnchor.get(renderAnchor(candidate.anchor));
      const entry = manifestEntryFor(slotId, simple.value);
      if (entry !== null) manifest.push(entry);
    }
    setPointer(documentFor(binding.sourcePath), binding.pointer, simple.value);
    values.push({
      fieldId: binding.fieldId,
      owner: ownerFor(binding),
      type: simple.type,
      value: simple.value,
    } as ManagedSiteContentValue);
  }

  return {
    values,
    assetManifest: dedupeManifest(manifest),
    sourceDocuments: new Map([...documents].map(([path, document]) => [path, document])),
  };
}

function dedupeManifest(
  entries: readonly ManagedSiteAssetManifestEntry[],
): readonly ManagedSiteAssetManifestEntry[] {
  const bySlot = new Map<string, ManagedSiteAssetManifestEntry>();
  for (const entry of entries) bySlot.set(entry.assetSlotId, entry);
  return [...bySlot.values()];
}

interface ImageShapedValue {
  readonly path: string;
  readonly sha256: string;
  readonly mimeType: string;
  readonly width: number;
  readonly height: number;
  readonly bytes: number;
}

function isImageShaped(value: JsonValue): value is JsonValue & ImageShapedValue {
  if (!isJsonObject(value)) return false;
  return typeof value["sha256"] === "string" && typeof value["path"] === "string";
}

