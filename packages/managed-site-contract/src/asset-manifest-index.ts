import type { ManagedSiteAssetManifestEntry } from "./content.js";
import type { ManagedAssetSlotDescriptor } from "./values.js";

/**
 * An asset manifest names material by repository path. A slot may hold several
 * paths (one per distinct image its values use, e.g. one per collection item),
 * and a path may sit under several slots as long as its material is identical,
 * so an entry's identity is the (slot, path) pair.
 */
export type AssetManifestIndex = ReadonlyMap<
  string,
  ReadonlyMap<string, ManagedSiteAssetManifestEntry>
>;

export const ASSET_MATERIAL_KEYS = Object.freeze([
  "path",
  "sha256",
  "mimeType",
  "width",
  "height",
  "bytes",
] as const);

export function sameAssetMaterial(
  left: Pick<ManagedSiteAssetManifestEntry, (typeof ASSET_MATERIAL_KEYS)[number]>,
  right: Pick<ManagedSiteAssetManifestEntry, (typeof ASSET_MATERIAL_KEYS)[number]>,
): boolean {
  return ASSET_MATERIAL_KEYS.every((key) => left[key] === right[key]);
}

export function manifestEntryAt(
  index: AssetManifestIndex,
  assetSlotId: string,
  path: string,
): ManagedSiteAssetManifestEntry | undefined {
  return index.get(assetSlotId)?.get(path);
}

type MutableAssetManifestIndex = Map<
  string,
  Map<string, ManagedSiteAssetManifestEntry>
>;

export function emptyManifestIndex(): MutableAssetManifestIndex {
  return new Map();
}

/** Adds an entry, returning the entry already held at its (slot, path), if any. */
export function addManifestEntry(
  index: MutableAssetManifestIndex,
  entry: ManagedSiteAssetManifestEntry,
): ManagedSiteAssetManifestEntry | undefined {
  const byPath = index.get(entry.assetSlotId) ?? new Map();
  index.set(entry.assetSlotId, byPath);
  const existing = byPath.get(entry.path);
  if (existing === undefined) byPath.set(entry.path, entry);
  return existing;
}

/**
 * Canonical manifest order: contract slot order, then path by code unit (the
 * default string sort). A manifest holding one entry per slot keeps exactly
 * its previous order.
 */
export function orderedManifestEntries(
  index: AssetManifestIndex,
  assets: readonly ManagedAssetSlotDescriptor[],
): readonly ManagedSiteAssetManifestEntry[] {
  return assets.flatMap((asset) => {
    const byPath = index.get(asset.id);
    if (byPath === undefined) return [];
    return [...byPath.keys()].sort().map((path) => byPath.get(path)!);
  });
}
