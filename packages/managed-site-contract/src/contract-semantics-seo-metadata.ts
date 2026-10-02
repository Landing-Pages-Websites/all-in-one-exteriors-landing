import type { ManagedSiteContractV1 } from "./contract.js";
import { collectManagedSiteContractOccurrences } from "./contract-occurrence-registry.js";
import { ManagedSiteContractError } from "./errors.js";
import {
  isManagedSeoTextSemantic,
  MAX_MANAGED_SEO_TEXT_CHARACTERS,
  type ManagedFieldDescriptor,
  type ManagedSeoTextSemantic,
} from "./fields.js";
import type { ManagedInternalValueType } from "./internal-value-types.js";
import type { ManagedInternalProtectedField } from "./seo.js";

type StaticPageSeo = ManagedSiteContractV1["internalSeo"]["pages"][number];
type MetadataShape = Pick<StaticPageSeo["metadata"], "title" | "description" | "canonical" | "indexing"> & {
  readonly social: Pick<StaticPageSeo["metadata"]["social"], "title" | "description">;
};

interface MetadataSlotPolicy {
  readonly valueType: ManagedInternalValueType;
  readonly semantic: string;
  /** The rendered semantic a customer may own this slot through; null keeps it protected. */
  readonly editableSemantic: ManagedSeoTextSemantic | null;
}

/**
 * What every metadata slot may name, for static and generated pages alike. A
 * slot is either a protected field of its own value type and semantic, or, for
 * a static page's title and description only, the page's own editable field.
 */
export const MANAGED_METADATA_SLOT_POLICY = Object.freeze({
  title: { valueType: "string", semantic: "seo.title", editableSemantic: "seo_title" },
  description: { valueType: "string", semantic: "seo.description", editableSemantic: "seo_description" },
  canonical: { valueType: "url", semantic: "seo.canonical", editableSemantic: null },
  indexing: { valueType: "indexing_directives", semantic: "seo.indexing", editableSemantic: null },
} as const satisfies Record<string, MetadataSlotPolicy>);

export type ManagedMetadataSlot = keyof typeof MANAGED_METADATA_SLOT_POLICY;

export interface ManagedMetadataFieldReference {
  readonly slot: ManagedMetadataSlot;
  /** Where under `metadata` the reference sits, as occurrence locations spell it. */
  readonly path: string;
  readonly fieldId: string;
  /** The slot's own key, not its social echo: the reference an editable field must have. */
  readonly primary: boolean;
}

/** Every field a page's metadata names. A social title answers to the title policy. */
export function metadataFieldReferences(
  metadata: MetadataShape,
): readonly ManagedMetadataFieldReference[] {
  const references = [
    { slot: "title", path: "title", fieldId: metadata.title, primary: true },
    { slot: "description", path: "description", fieldId: metadata.description, primary: true },
    { slot: "canonical", path: "canonical", fieldId: metadata.canonical, primary: true },
    { slot: "indexing", path: "indexing", fieldId: metadata.indexing, primary: true },
    { slot: "title", path: "social.title", fieldId: metadata.social.title, primary: false },
    { slot: "description", path: "social.description", fieldId: metadata.social.description, primary: false },
  ] as const;
  return references.filter(
    (reference): reference is (typeof references)[number] & { readonly fieldId: string } =>
      reference.fieldId !== null,
  );
}

function fail(message: string): never {
  throw new ManagedSiteContractError("CONTRACT_SEO_FIELD_POLICY", message);
}

interface RenderedFieldEntry {
  readonly field: ManagedFieldDescriptor;
  readonly declaringPageId: string;
}

function indexRenderedFields(contract: ManagedSiteContractV1): ReadonlyMap<string, RenderedFieldEntry> {
  const indexed = new Map<string, RenderedFieldEntry>();
  for (const page of contract.pages) {
    for (const section of page.sections) {
      for (const field of section.fields) {
        indexed.set(field.id, { field, declaringPageId: page.id });
      }
    }
  }
  return indexed;
}

/** Declared on this page, used once on it, and nowhere else: the page owns it alone. */
function ownedByPage(entry: RenderedFieldEntry, pageId: string): boolean {
  const { field } = entry;
  const [usage] = field.usages;
  return (
    field.scope === "page" &&
    field.classification === "customer_editable" &&
    entry.declaringPageId === pageId &&
    field.usages.length === 1 &&
    usage?.pageId === pageId &&
    usage.itemId === null
  );
}

function isEditableSeoText(
  entry: RenderedFieldEntry | undefined,
  pageId: string,
  semantic: ManagedSeoTextSemantic,
): boolean {
  if (entry === undefined) return false;
  const { field } = entry;
  if (field.type !== "plain_text") return false;
  return (
    field.semantic === semantic &&
    ownedByPage(entry, pageId) &&
    field.constraints.newlines === "forbid" &&
    field.constraints.maxLength <= MAX_MANAGED_SEO_TEXT_CHARACTERS
  );
}

function isLegacyProtected(
  field: ManagedInternalProtectedField | undefined,
  policy: MetadataSlotPolicy,
): boolean {
  return (
    field !== undefined &&
    field.valueType === policy.valueType &&
    field.semantic === policy.semantic
  );
}

function validateMetadataTargets(
  descriptor: StaticPageSeo,
  protectedFields: ReadonlyMap<string, ManagedInternalProtectedField>,
  renderedFields: ReadonlyMap<string, RenderedFieldEntry>,
): void {
  for (const reference of metadataFieldReferences(descriptor.metadata)) {
    const policy: MetadataSlotPolicy = MANAGED_METADATA_SLOT_POLICY[reference.slot];
    if (isLegacyProtected(protectedFields.get(reference.fieldId), policy)) continue;
    const editable =
      policy.editableSemantic !== null &&
      isEditableSeoText(renderedFields.get(reference.fieldId), descriptor.pageId, policy.editableSemantic);
    if (!editable) {
      fail(`Page ${descriptor.pageId} metadata.${reference.path} names an unsafe field: ${reference.fieldId}`);
    }
  }
}

function validateShareImage(
  descriptor: StaticPageSeo,
  renderedFields: ReadonlyMap<string, RenderedFieldEntry>,
): void {
  const { image, imageFieldId } = descriptor.metadata.social;
  if (imageFieldId === undefined) return;
  const entry = renderedFields.get(imageFieldId);
  const valid =
    entry !== undefined &&
    entry.field.type === "image" &&
    image !== null &&
    entry.field.assetSlotId === image &&
    ownedByPage(entry, descriptor.pageId);
  if (!valid) {
    fail(`Page ${descriptor.pageId} share image is not its own image on slot ${image ?? "null"}: ${imageFieldId}`);
  }
}

interface AllowedLocation {
  readonly pageId: string;
  readonly semantic: ManagedSeoTextSemantic;
  readonly primary: boolean;
}

/** Every metadata position an editable SEO text field may be named from, by occurrence location. */
function allowedSeoTextLocations(contract: ManagedSiteContractV1): ReadonlyMap<string, AllowedLocation> {
  const allowed = new Map<string, AllowedLocation>();
  for (const [index, descriptor] of contract.internalSeo.pages.entries()) {
    for (const reference of metadataFieldReferences(descriptor.metadata)) {
      const semantic = MANAGED_METADATA_SLOT_POLICY[reference.slot].editableSemantic;
      if (semantic === null) continue;
      allowed.set(`internalSeo.pages[${index}].metadata.${reference.path}`, {
        pageId: descriptor.pageId,
        semantic,
        primary: reference.primary,
      });
    }
  }
  return allowed;
}

function fieldReferenceLocations(contract: ManagedSiteContractV1): ReadonlyMap<string, readonly string[]> {
  const locations = new Map<string, string[]>();
  for (const occurrence of collectManagedSiteContractOccurrences(contract)) {
    if (occurrence.role !== "reference" || occurrence.idKind !== "field") continue;
    const existing = locations.get(occurrence.id);
    if (existing === undefined) locations.set(occurrence.id, [occurrence.location]);
    else existing.push(occurrence.location);
  }
  return locations;
}

function refuseSeoTextItemFields(contract: ManagedSiteContractV1): void {
  for (const collection of contract.collections) {
    for (const field of collection.itemFields) {
      if (field.type === "plain_text" && isManagedSeoTextSemantic(field.semantic)) {
        fail(`Collection ${collection.id} item field cannot be page SEO: ${field.id}`);
      }
    }
  }
}

/**
 * An editable SEO text field is named only from its own page's metadata slot
 * of the same semantic (or that slot's social echo), and at least from the
 * slot itself. Read off every classified reference, so a reference path added
 * later is refused rather than admitted by omission.
 */
function validateSeoTextPlacement(
  contract: ManagedSiteContractV1,
  renderedFields: ReadonlyMap<string, RenderedFieldEntry>,
  referenced: ReadonlyMap<string, readonly string[]>,
): void {
  refuseSeoTextItemFields(contract);
  const allowed = allowedSeoTextLocations(contract);
  for (const { field, declaringPageId } of renderedFields.values()) {
    if (field.type !== "plain_text" || !isManagedSeoTextSemantic(field.semantic)) continue;
    const places = (referenced.get(field.id) ?? []).map((location) => allowed.get(location));
    const confined = places.every(
      (place) => place?.pageId === declaringPageId && place.semantic === field.semantic,
    );
    const named = places.some((place) => place?.primary === true);
    if (!confined || !named) {
      fail(`SEO field ${field.id} must be named by its own page's metadata only`);
    }
  }
}

/**
 * A share image field is named from exactly one place: the `imageFieldId` of
 * the page that owns it (which `validateShareImage` checks). Any second
 * classified reference -- another page's metadata, an alias group, the heading
 * outline, JSON-LD, identity, or a path added later -- is refused.
 */
function validateShareImagePlacement(
  contract: ManagedSiteContractV1,
  referenced: ReadonlyMap<string, readonly string[]>,
): void {
  for (const descriptor of contract.internalSeo.pages) {
    const { imageFieldId } = descriptor.metadata.social;
    if (imageFieldId === undefined) continue;
    if ((referenced.get(imageFieldId) ?? []).length !== 1) {
      fail(`Share image field ${imageFieldId} must be named by its own page's metadata only`);
    }
  }
}

export function validateStaticPageMetadata(contract: ManagedSiteContractV1): void {
  const protectedFields = new Map(
    contract.internalSeo.protectedFields.map((field) => [field.id, field]),
  );
  const renderedFields = indexRenderedFields(contract);
  for (const descriptor of contract.internalSeo.pages) {
    validateMetadataTargets(descriptor, protectedFields, renderedFields);
    validateShareImage(descriptor, renderedFields);
  }
  const referenced = fieldReferenceLocations(contract);
  validateSeoTextPlacement(contract, renderedFields, referenced);
  validateShareImagePlacement(contract, referenced);
}
