import {
  isManagedServedAssetPath,
  ManagedSiteContractError,
  parseRepositoryPath,
} from "@landing-pages-websites/managed-site-contract";

/**
 * Where a repository path is decided, once.
 *
 * The proposer builds paths in three places -- the configured roots, the content
 * files it emits, and the assets it points at -- and the standard bounds all of
 * them the same way. Asking the canonical parser rather than describing its rules
 * again is what keeps a path that loads from failing later at emission.
 */

export function isRepositoryPath(candidate: string): boolean {
  try {
    parseRepositoryPath(candidate);
    return true;
  } catch (error) {
    if (error instanceof ManagedSiteContractError) return false;
    throw error;
  }
}

/** An image reference is written as a public URL; the file lives under the root. */
function relativeAssetPath(source: string): string {
  return source.startsWith("/") ? source.slice(1) : source;
}

/**
 * The repository path an image reference resolves to, or null when the result is
 * not a path the standard can carry. Judged by the contract's own
 * isManagedServedAssetPath, so every image path the proposer emits is one the
 * pinned contract accepts by construction, not by the config happening to agree.
 *
 * Both the contract emitter and the content emitter need this path, so they get
 * it from here: two constructions of one path is two chances for a proposal to
 * name a file its own manifest does not.
 */
export function assetRepositoryPath(assetRoot: string, source: string): string | null {
  const candidate = `${assetRoot}/${relativeAssetPath(source)}`;
  return isManagedServedAssetPath(candidate) ? candidate : null;
}

/**
 * Whether the configured root is what made an asset path unrepresentable -- too
 * long, or not a served path -- which is the difference between a setting to
 * change and a file to move.
 */
export function assetRootIsAtFault(assetRoot: string, source: string): boolean {
  const relative = relativeAssetPath(source);
  return isRepositoryPath(relative) && !isManagedServedAssetPath(`${assetRoot}/${relative}`);
}
