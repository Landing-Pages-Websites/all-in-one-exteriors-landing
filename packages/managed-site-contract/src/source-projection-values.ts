import {
  addManifestEntry,
  emptyManifestIndex,
  orderedManifestEntries,
} from "./asset-manifest-index.js";
import type {
  ManagedContentOwner,
  ManagedSiteAssetManifestEntry,
} from "./content.js";
import type { ManagedSiteContractV1 } from "./contract.js";
import type {
  ManagedCollectionItemField,
  ManagedFieldDescriptor,
} from "./fields.js";
import type { StableId } from "./ids.js";
import type { ManagedInternalValueType } from "./internal-value-types.js";
import type { JsonValue } from "./json.js";
import type { ManagedInternalProtectedField } from "./seo.js";
import { ManagedSiteSourceResolver } from "./source-documents.js";
import {
  parseManagedImageValueInput,
  type ManagedAssetSlotDescriptor,
  type ManagedImageValue,
} from "./values.js";

type RenderedCollectionItemField = Exclude<
  ManagedCollectionItemField,
  { readonly type: "internal_protected" }
>;
type RenderedDescriptor = ManagedFieldDescriptor | RenderedCollectionItemField;
type RawContentValue = Readonly<Record<string, unknown>>;
interface ProtectedDescriptor {
  readonly id: StableId<"field">;
  readonly valueType: ManagedInternalValueType;
}

function manifestEntry(
  assetSlotId: StableId<"asset">,
  image: ManagedImageValue,
): ManagedSiteAssetManifestEntry {
  return {
    assetSlotId,
    path: image.path,
    sha256: image.sha256,
    mimeType: image.mimeType,
    width: image.width,
    height: image.height,
    bytes: image.bytes,
  };
}

export class ProjectedAssetManifest {
  private readonly entries = emptyManifestIndex();

  // The first material seen at a (slot, path) is kept; a later value at that
  // path with different material then fails content validation as a mismatch.
  public record(descriptor: RenderedDescriptor, value: JsonValue): void {
    if (descriptor.type !== "image") return;
    const image = parseManagedImageValueInput(value);
    addManifestEntry(this.entries, manifestEntry(descriptor.assetSlotId, image));
  }

  public ordered(
    assets: readonly ManagedAssetSlotDescriptor[],
  ): readonly ManagedSiteAssetManifestEntry[] {
    return orderedManifestEntries(this.entries, assets);
  }
}

export function projectRenderedValue(
  descriptor: RenderedDescriptor,
  owner: ManagedContentOwner,
  value: JsonValue,
  manifest: ProjectedAssetManifest,
): RawContentValue {
  manifest.record(descriptor, value);
  return {
    fieldId: descriptor.id,
    owner,
    type: descriptor.type,
    value,
  };
}

function projectProtectedValue(
  descriptor: ProtectedDescriptor,
  owner: ManagedContentOwner,
  value: JsonValue,
): RawContentValue {
  return {
    fieldId: descriptor.id,
    owner,
    type: "internal_protected",
    valueType: descriptor.valueType,
    value,
  };
}

export function projectCollectionItemValue(
  descriptor: ManagedCollectionItemField,
  owner: ManagedContentOwner,
  value: JsonValue,
  manifest: ProjectedAssetManifest,
): RawContentValue {
  if (descriptor.type !== "internal_protected") {
    return projectRenderedValue(descriptor, owner, value, manifest);
  }
  return projectProtectedValue(descriptor, owner, value);
}

function requiredOwner(field: ManagedFieldDescriptor): ManagedContentOwner {
  if (field.scope === "site") return { kind: "site" };
  return { kind: "page", pageId: field.usages[0].pageId };
}

function projectField(
  field: ManagedFieldDescriptor,
  sources: ManagedSiteSourceResolver,
  manifest: ProjectedAssetManifest,
): RawContentValue {
  const source = sources.resolve(field.resolver);
  return projectRenderedValue(
    field,
    requiredOwner(field),
    source.value,
    manifest,
  );
}

function projectProtectedField(
  field: ManagedInternalProtectedField,
  sources: ManagedSiteSourceResolver,
): RawContentValue {
  const source = sources.resolve(field.resolver);
  const owner: ManagedContentOwner =
    field.scope === "site"
      ? { kind: "site" }
      : { kind: "page", pageId: field.usages[0].pageId };
  return projectProtectedValue(field, owner, source.value);
}

export function projectNonItemValues(
  contract: ManagedSiteContractV1,
  sources: ManagedSiteSourceResolver,
  manifest: ProjectedAssetManifest,
): readonly RawContentValue[] {
  const values: RawContentValue[] = [];
  for (const page of contract.pages) {
    for (const section of page.sections) {
      for (const field of section.fields) {
        values.push(projectField(field, sources, manifest));
      }
    }
  }
  for (const field of contract.internalSeo.protectedFields) {
    values.push(projectProtectedField(field, sources));
  }
  return values;
}
