import {
  validateParsedManagedFieldValue,
  type ManagedSiteAssetManifestEntry,
  type ManagedSiteContentValue,
} from "./content.js";
import {
  contentSemanticFail,
  type ManagedContentSemanticFacts,
  type ManagedResolvedContentValue,
} from "./content-semantics-facts.js";
import {
  addManifestEntry,
  emptyManifestIndex,
  manifestEntryAt,
  sameAssetMaterial,
  type AssetManifestIndex,
} from "./asset-manifest-index.js";
import { ManagedSiteContractError } from "./errors.js";
import { summarizeManagedRichText } from "./rich-text.js";
import {
  validateManagedImageValue,
  type ManagedAssetSlotDescriptor,
  type ManagedImageValue,
} from "./values.js";

function stableSuffix(id: string): string {
  return id.slice(id.indexOf("_") + 1);
}

function asContentPolicy(action: () => void): void {
  try {
    action();
  } catch (error) {
    if (error instanceof ManagedSiteContractError) {
      contentSemanticFail("CONTENT_VALUE_POLICY", error.message);
    }
    throw error;
  }
}

function validateResolvedValue(resolved: ManagedResolvedContentValue): void {
  if (resolved.kind === "protected") {
    const { descriptor, value } = resolved;
    if (
      value.type !== "internal_protected" ||
      value.valueType !== descriptor.valueType
    ) {
      contentSemanticFail(
        "CONTENT_VALUE_POLICY",
        `Protected value conflicts with field ${descriptor.id}`,
      );
    }
    return;
  }
  asContentPolicy(() =>
    validateParsedManagedFieldValue(resolved.descriptor, resolved.value),
  );
}

function assertLivePage(facts: ManagedContentSemanticFacts, pageId: string): void {
  if (facts.pages.has(pageId)) return;
  if (facts.tombstones.has(pageId)) {
    contentSemanticFail(
      "CONTENT_LINK_PAGE_TOMBSTONED",
      `Managed link resolves to tombstoned page ${pageId}`,
    );
  }
  const suffixKind = facts.contractIdKindsBySuffix.get(stableSuffix(pageId));
  if (suffixKind !== undefined && suffixKind !== "page") {
    contentSemanticFail(
      "CONTENT_ID_CROSS_KIND_COLLISION",
      `Managed link reuses ${suffixKind} identity entropy`,
    );
  }
  contentSemanticFail(
    "CONTENT_LINK_PAGE_UNRESOLVED",
    `Managed link does not resolve to a live page: ${pageId}`,
  );
}

/**
 * An internal destination names a page and nothing else: no item. A generated
 * page is a pattern that only an item fills, so it has no one path a link can
 * take, and every renderer of one would have to fail or invent a URL. So an
 * internal destination must name a page with a single static path, whether it
 * is a link field's or a prose link mark's: ONE predicate, refused here, where
 * the value is judged, rather than at render. The two keep their own codes so a
 * refusal still says which kind of value it was.
 */
function isManagedPathedLinkPage(
  facts: Pick<ManagedContentSemanticFacts, "pages">,
  pageId: string,
): boolean {
  return facts.pages.get(pageId)?.route.kind === "static";
}

const UNPATHED_LINK_PAGE = {
  field: { code: "CONTENT_LINK_PAGE_UNPATHED", noun: "A link field" },
  mark: { code: "CONTENT_RICH_TEXT_LINK_PAGE_UNPATHED", noun: "A rich-text link" },
} as const;

function assertPathedPage(
  facts: ManagedContentSemanticFacts,
  pageId: string,
  kind: keyof typeof UNPATHED_LINK_PAGE,
): void {
  if (isManagedPathedLinkPage(facts, pageId)) return;
  const { code, noun } = UNPATHED_LINK_PAGE[kind];
  contentSemanticFail(code, `${noun} names page ${pageId}, which has no single path`);
}

function validateLinkDestination(
  facts: ManagedContentSemanticFacts,
  value: ManagedSiteContentValue,
): void {
  if (value.type === "link" && value.value.destination.kind === "internal") {
    assertLivePage(facts, value.value.destination.pageId);
    assertPathedPage(facts, value.value.destination.pageId, "field");
  }
  if (value.type !== "rich_text") return;
  // Prose links live on the text they cover, so the page a link names is reached
  // through marks rather than through a node of its own.
  for (const node of summarizeManagedRichText(value.value).textNodes) {
    for (const mark of node.marks ?? []) {
      if (mark.type === "link" && mark.destination.kind === "internal") {
        assertLivePage(facts, mark.destination.pageId);
        assertPathedPage(facts, mark.destination.pageId, "mark");
      }
    }
  }
}

export function validateManagedContentValues(
  facts: ManagedContentSemanticFacts,
): void {
  for (const resolved of facts.resolvedValues) {
    validateResolvedValue(resolved);
    validateLinkDestination(facts, resolved.value);
  }
}

function materialMatchesSlot(
  slot: ManagedAssetSlotDescriptor,
  material: ManagedSiteAssetManifestEntry,
): boolean {
  const dimensionsValid =
    material.width >= slot.minWidth &&
    material.width <= slot.maxWidth &&
    material.height >= slot.minHeight &&
    material.height <= slot.maxHeight;
  const aspectValid = slot.aspectRatios.some(
    (ratio) => material.width * ratio.height === material.height * ratio.width,
  );
  return (
    dimensionsValid &&
    aspectValid &&
    slot.outputMimeTypes.includes(material.mimeType) &&
    material.bytes <= slot.maxBytes
  );
}

function imageSlotId(resolved: ManagedResolvedContentValue): string | null {
  if (resolved.kind === "protected" || resolved.descriptor.type !== "image") {
    return null;
  }
  return resolved.descriptor.assetSlotId;
}

function validateManifestEntry(
  facts: ManagedContentSemanticFacts,
  entry: ManagedSiteAssetManifestEntry,
): void {
  const slot = facts.assets.get(entry.assetSlotId);
  if (slot === undefined) {
    contentSemanticFail(
      "CONTENT_ASSET_SLOT_UNRESOLVED",
      `Asset manifest does not resolve to a live slot: ${entry.assetSlotId}`,
    );
  }
  if (!facts.referencedAssetIds.has(entry.assetSlotId)) {
    contentSemanticFail(
      "CONTENT_ASSET_MANIFEST_UNUSED",
      `Asset manifest slot is not referenced: ${entry.assetSlotId}`,
    );
  }
  if (!materialMatchesSlot(slot, entry)) {
    contentSemanticFail(
      "CONTENT_ASSET_POLICY",
      `Asset manifest violates slot ${entry.assetSlotId}`,
    );
  }
}

function indexManifest(facts: ManagedContentSemanticFacts): AssetManifestIndex {
  const index = emptyManifestIndex();
  // One piece of material per repository path, whichever slots name it.
  const byPath = new Map<string, ManagedSiteAssetManifestEntry>();
  for (const entry of facts.content.assetManifest) {
    if (addManifestEntry(index, entry) !== undefined) {
      contentSemanticFail(
        "CONTENT_ASSET_MANIFEST_DUPLICATE",
        `Asset manifest repeats slot ${entry.assetSlotId} at ${entry.path}`,
      );
    }
    validateManifestEntry(facts, entry);
    const samePath = byPath.get(entry.path);
    if (samePath !== undefined && !sameAssetMaterial(samePath, entry)) {
      contentSemanticFail(
        "CONTENT_ASSET_PATH_CONFLICT",
        `Asset manifest gives ${entry.path} conflicting material`,
      );
    }
    byPath.set(entry.path, samePath ?? entry);
  }
  return index;
}

function validateImagePolicy(
  slot: ManagedAssetSlotDescriptor,
  image: ManagedImageValue,
): void {
  try {
    validateManagedImageValue(slot, image);
  } catch (error) {
    if (error instanceof ManagedSiteContractError) {
      contentSemanticFail("CONTENT_ASSET_POLICY", error.message);
    }
    throw error;
  }
}

function mismatch(assetSlotId: string): never {
  return contentSemanticFail(
    "CONTENT_ASSET_MANIFEST_MISMATCH",
    `Image material conflicts with manifest slot ${assetSlotId}`,
  );
}

function requiredManifest(
  manifest: AssetManifestIndex,
  assetSlotId: string,
  image: ManagedImageValue,
): ManagedSiteAssetManifestEntry {
  const entry = manifestEntryAt(manifest, assetSlotId, image.path);
  if (entry !== undefined) return entry;
  // A slot the manifest holds material for is a mismatch with it; a slot it has
  // no material for at all is missing, whichever other slot holds this path.
  if (manifest.has(assetSlotId)) return mismatch(assetSlotId);
  return contentSemanticFail(
    "CONTENT_ASSET_MANIFEST_MISSING",
    `Image value has no manifest for slot ${assetSlotId}`,
  );
}

function validateImageValue(
  facts: ManagedContentSemanticFacts,
  manifest: AssetManifestIndex,
  resolved: ManagedResolvedContentValue,
): ManagedSiteAssetManifestEntry | null {
  const assetSlotId = imageSlotId(resolved);
  if (assetSlotId === null) return null;
  if (resolved.value.type !== "image") {
    contentSemanticFail(
      "CONTENT_VALUE_POLICY",
      `Image field ${resolved.descriptor.id} has a non-image value`,
    );
  }
  const slot = facts.assets.get(assetSlotId);
  if (slot === undefined) {
    contentSemanticFail(
      "CONTENT_ASSET_SLOT_UNRESOLVED",
      `Image field does not resolve to a live slot: ${assetSlotId}`,
    );
  }
  const image = resolved.value.value;
  validateImagePolicy(slot, image);
  const entry = requiredManifest(manifest, assetSlotId, image);
  if (!sameAssetMaterial(entry, image)) mismatch(assetSlotId);
  return entry;
}

/**
 * Every entry of a slot that image values use must be used by one of them, so
 * a slot cannot carry material nothing renders. A slot no value uses (an
 * SEO-only slot) keeps its single entry, as before paths keyed the manifest.
 */
function assertEntriesUsed(
  manifest: AssetManifestIndex,
  used: ReadonlySet<ManagedSiteAssetManifestEntry>,
  usedSlots: ReadonlySet<string>,
): void {
  for (const [assetSlotId, byPath] of manifest) {
    if (!usedSlots.has(assetSlotId)) {
      if (byPath.size > 1) {
        contentSemanticFail(
          "CONTENT_ASSET_MANIFEST_DUPLICATE",
          `Asset manifest repeats slot ${assetSlotId}`,
        );
      }
      continue;
    }
    for (const entry of byPath.values()) {
      if (!used.has(entry)) {
        contentSemanticFail(
          "CONTENT_ASSET_MANIFEST_UNUSED",
          `Asset manifest entry is not used: ${assetSlotId} ${entry.path}`,
        );
      }
    }
  }
}

/**
 * A page's social image and primary image each name a slot, and the page needs
 * exactly one picture from it. A slot holding several entries (one per item
 * image) has no single answer, so the contract must not point SEO at it.
 *
 * A share image with an `imageFieldId` is not read from the slot: it is that
 * page-scoped field's value, one picture by construction, so a per-site social
 * slot holding one entry per page answers it exactly.
 */
function slotResolvedSeoImages(
  page: ManagedContentSemanticFacts["contract"]["internalSeo"]["pages"][number],
): readonly (string | null)[] {
  const socialBySlot =
    page.metadata.social.imageFieldId === undefined ? page.metadata.social.image : null;
  return [socialBySlot, page.primaryImageAssetSlotId];
}

function assertSeoImagesUnambiguous(
  facts: ManagedContentSemanticFacts,
  manifest: AssetManifestIndex,
): void {
  for (const page of facts.contract.internalSeo.pages) {
    for (const assetSlotId of slotResolvedSeoImages(page)) {
      if (assetSlotId === null) continue;
      if ((manifest.get(assetSlotId)?.size ?? 0) > 1) {
        contentSemanticFail(
          "CONTENT_SEO_IMAGE_AMBIGUOUS",
          `Page ${page.pageId} SEO image slot ${assetSlotId} holds several images`,
        );
      }
    }
  }
}

export function validateManagedContentAssets(
  facts: ManagedContentSemanticFacts,
): void {
  const manifest = indexManifest(facts);
  const used = new Set<ManagedSiteAssetManifestEntry>();
  const usedSlots = new Set<string>();
  for (const resolved of facts.resolvedValues) {
    const entry = validateImageValue(facts, manifest, resolved);
    if (entry === null) continue;
    used.add(entry);
    usedSlots.add(entry.assetSlotId);
  }
  assertEntriesUsed(manifest, used, usedSlots);
  assertSeoImagesUnambiguous(facts, manifest);
}
