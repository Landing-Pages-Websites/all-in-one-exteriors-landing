import type { ManagedSiteContentDocument } from "./content.js";
import type { ManagedSiteContractV1 } from "./contract.js";
import { ManagedSiteContractError } from "./errors.js";
import { managedPageH1Fields, managedSeoPageIds } from "./rendered-headings.js";

/**
 * A page that declared no H1 field in production and declares its H1 now:
 * the text a page already showed, made a managed field (a headline may span
 * several fields). Admitted and listed, so a reviewer sees each one.
 */
export interface ManagedSiteH1AdoptionV1 {
  readonly pageId: string;
  readonly fieldIds: readonly string[];
}

interface Side {
  readonly contract: ManagedSiteContractV1;
  readonly content: ManagedSiteContentDocument;
}

function sameMembers(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...left].every((id) => right.has(id));
}

/**
 * Every page, static or generated, renders the H1 fields production did, read
 * from every field it renders (`managedPageH1Fields`). A page that had none
 * may gain its H1 fields in one change, which is returned to be listed; once
 * a page has H1 fields, gaining, losing or swapping one is refused. A
 * declared migration passes the fields it renames, so a migrated H1 source
 * reads as its target.
 */
export function assertProductionH1sKept(
  production: Side,
  candidate: Side,
  renames: ReadonlyMap<string, string>,
): readonly ManagedSiteH1AdoptionV1[] {
  const adopted: ManagedSiteH1AdoptionV1[] = [];
  for (const pageId of managedSeoPageIds(production.contract)) {
    const kept = managedPageH1Fields(production.contract, production.content, pageId);
    const before = new Set([...kept].map((id) => renames.get(id) ?? id));
    const after = managedPageH1Fields(candidate.contract, candidate.content, pageId);
    if (sameMembers(before, after)) continue;
    if (before.size > 0) {
      throw new ManagedSiteContractError("COMPATIBILITY_PAGE_SEO_CHANGED", `The page's H1 changed: ${pageId}`);
    }
    adopted.push(Object.freeze({ pageId, fieldIds: Object.freeze([...after].sort()) }));
  }
  return Object.freeze(adopted.sort((left, right) => (left.pageId < right.pageId ? -1 : 1)));
}
