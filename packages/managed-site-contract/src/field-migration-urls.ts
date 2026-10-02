import {
  assertManagedProductionUrlsAndSeoIdentity,
  type ManagedCompatibilitySides,
} from "./contract-compatibility-policy.js";
import type { ManagedSiteH1AdoptionV1 } from "./contract-compatibility-h1.js";
import type { ManagedSiteSeoReorderV1 } from "./contract-compatibility-seo-facts.js";
import type { ManagedSiteContractV1 } from "./contract.js";
import { ManagedSiteContractError } from "./errors.js";

function fail(code: string, message: string): never {
  throw new ManagedSiteContractError(code, message);
}

function assertRedirectsUnchanged(production: ManagedSiteContractV1, candidate: ManagedSiteContractV1): void {
  const kept = new Set(production.internalSeo.redirects.map((redirect) => redirect.fromPath));
  const added = candidate.internalSeo.redirects.find((redirect) => !kept.has(redirect.fromPath));
  if (added !== undefined) {
    fail("COMPATIBILITY_REDIRECT_CHANGED", `A field migration adds a redirect: ${added.fromPath}`);
  }
}

/**
 * A production SEO list the migrated candidate keeps in another order (a
 * target rendering in another section, say), listed in the proof exactly as
 * the ordinary result lists it.
 */
export type ManagedSiteFieldMigrationSeoReorderV1 = { readonly kind: "seo_reordered" } & ManagedSiteSeoReorderV1;

/**
 * A static page that declared no H1 field in production and declares its H1
 * now, listed in the proof exactly as the ordinary result's `adoptedH1` lists it.
 */
export type ManagedSiteFieldMigrationH1AdoptionV1 = { readonly kind: "h1_adopted" } & ManagedSiteH1AdoptionV1;

/**
 * The ordinary URL and SEO identity rule, read with production renamed by the
 * migration at its registered field references only, and URLs held exactly.
 * A migration declares fields, not URLs, and its proof has nowhere to name a
 * moved page or a new or changed redirect, so each is refused rather than
 * admitted unlisted. Returns the reordered SEO lists and H1 adoptions, for
 * the proof to list.
 */
export function assertManagedSiteFieldMigrationUrlsV1(
  sides: ManagedCompatibilitySides,
  renames: ReadonlyMap<string, string>,
): readonly (ManagedSiteFieldMigrationSeoReorderV1 | ManagedSiteFieldMigrationH1AdoptionV1)[] {
  const { changedRedirects, reorderedSeo, adoptedH1 } = assertManagedProductionUrlsAndSeoIdentity(sides, renames);
  const [changed] = changedRedirects;
  if (changed !== undefined) {
    fail("COMPATIBILITY_REDIRECT_CHANGED", `A field migration changes a production redirect: ${changed.fromPath}`);
  }
  assertRedirectsUnchanged(sides.productionContract, sides.candidateContract);
  return [
    ...reorderedSeo.map((reorder) => ({ kind: "seo_reordered" as const, ...reorder })),
    ...adoptedH1.map((adoption) => ({ kind: "h1_adopted" as const, ...adoption })),
  ];
}
