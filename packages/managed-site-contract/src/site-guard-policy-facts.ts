import type {
  ManagedSiteAssetManifestEntry,
  ManagedSiteContentDocument,
} from "./content.js";
import { sameAssetMaterial } from "./asset-manifest-index.js";
import { validateManagedSiteContractV1ContentSemantics } from "./content-semantics.js";
import type { ManagedSiteContractV1 } from "./contract.js";
import { collectManagedSiteContractV1Facts } from "./contract-semantics-facts.js";
import { validateManagedSiteContractV1Semantics } from "./contract-semantics.js";
import { ManagedSiteContractError } from "./errors.js";

export interface ManagedSiteGuardContractFactsV1 {
  readonly sourcePaths: readonly string[];
}

export interface ManagedSiteGuardAssetFactV1 {
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
}

export interface ManagedSiteGuardPolicyFactsV1
  extends ManagedSiteGuardContractFactsV1 {
  readonly assets: readonly ManagedSiteGuardAssetFactV1[];
}

function fail(code: string, message: string): never {
  throw new ManagedSiteContractError(code, message);
}

function comparePath(
  left: { readonly path: string },
  right: { readonly path: string },
): number {
  return left.path < right.path ? -1 : left.path > right.path ? 1 : 0;
}

function sourcePaths(contract: ManagedSiteContractV1): readonly string[] {
  const facts = collectManagedSiteContractV1Facts(contract);
  return Object.freeze(
    [...new Set(facts.sources.map(({ address }) => address.path))].sort(),
  );
}

function assetFact(
  entry: ManagedSiteAssetManifestEntry,
): ManagedSiteGuardAssetFactV1 {
  return Object.freeze({
    path: entry.path,
    sha256: entry.sha256,
    bytes: entry.bytes,
  });
}

/**
 * Compares the whole manifest material, not just the fact's sha256 and bytes,
 * so the Guard refuses a path with two materials even if content validation
 * did not run first. Exported for tests only; not part of the package barrel.
 */
export function assetFacts(
  content: ManagedSiteContentDocument,
): readonly ManagedSiteGuardAssetFactV1[] {
  const byPath = new Map<string, ManagedSiteAssetManifestEntry>();
  for (const entry of content.assetManifest) {
    const existing = byPath.get(entry.path);
    if (existing !== undefined && !sameAssetMaterial(existing, entry)) {
      return fail(
        "GUARD_ASSET_PATH_CONFLICT",
        `Guard asset path has conflicting material: ${entry.path}`,
      );
    }
    if (existing === undefined) byPath.set(entry.path, entry);
  }
  return Object.freeze([...byPath.values()].map(assetFact).sort(comparePath));
}

function isAmbiguousPath(left: string, right: string): boolean {
  const leftAlias = left.normalize("NFKC").toLowerCase();
  const rightAlias = right.normalize("NFKC").toLowerCase();
  return (
    leftAlias === rightAlias ||
    leftAlias.startsWith(`${rightAlias}/`) ||
    rightAlias.startsWith(`${leftAlias}/`)
  );
}

function assertUnambiguousPaths(
  sources: readonly string[],
  assets: readonly ManagedSiteGuardAssetFactV1[],
): void {
  const paths = [...sources, ...assets.map(({ path }) => path)];
  for (const [index, path] of paths.entries()) {
    for (const candidate of paths.slice(index + 1)) {
      if (isAmbiguousPath(path, candidate)) {
        return fail(
          "GUARD_POLICY_PATH_AMBIGUOUS",
          `Guard policy paths are ambiguous: ${path}`,
        );
      }
    }
  }
}

export function deriveManagedSiteGuardContractFactsV1(
  contract: ManagedSiteContractV1,
): ManagedSiteGuardContractFactsV1 {
  validateManagedSiteContractV1Semantics(contract);
  const sources = sourcePaths(contract);
  assertUnambiguousPaths(sources, []);
  return Object.freeze({ sourcePaths: sources });
}

export function deriveManagedSiteGuardPolicyFactsV1(
  contract: ManagedSiteContractV1,
  content: ManagedSiteContentDocument,
): ManagedSiteGuardPolicyFactsV1 {
  validateManagedSiteContractV1ContentSemantics(contract, content);
  const sources = sourcePaths(contract);
  const assets = assetFacts(content);
  assertUnambiguousPaths(sources, assets);
  return Object.freeze({ sourcePaths: sources, assets });
}
