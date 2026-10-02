import {
  collectSeoReorders,
  isPreservedBy,
  type ManagedSeoFactRules,
  type ManagedSiteSeoReorderV1,
} from "./contract-compatibility-seo-facts.js";
import { managedSiteContractWithRenamedFieldReferences } from "./contract-occurrence-location.js";
import { MANAGED_SITE_CONTRACT_OCCURRENCE_REGISTRY } from "./contract-occurrence-registry.js";
import type { ManagedSiteContractV1 } from "./contract.js";
import { ManagedSiteContractError } from "./errors.js";
import { managedSiteSeoDescriptorSchema } from "./seo.js";

/**
 * The `internalSeo` sections another rule owns: protected fields are held by
 * the field policy, redirects by the redirect rule. Every other section the
 * schema has, today or later, is compared here.
 */
export const MANAGED_SEO_SECTIONS_WITH_THEIR_OWN_RULE = Object.freeze(["protectedFields", "redirects"] as const);

/**
 * The page SEO facts a code change may change: values a site legitimately
 * corrects in code (All Points Media #61 took a hidden 404 page out of the
 * sitemap). Everything else in a section is compared.
 */
export const MANAGED_SEO_FACTS_NOT_COMPARED = Object.freeze([
  "intent.purpose",
  "sitemap",
  "internalLinks.minimumInboundLinks",
  "performanceBudget",
] as const);

/**
 * The sections whose null values are open slots a code change may fill: a
 * null business-identity key publishes nothing, so filling it adds a fact. A
 * null anywhere else is a fact of its own (a null share-card title means the
 * card keeps its own text), so filling it changes what is served.
 */
export const MANAGED_SEO_SECTIONS_WITH_OPEN_SLOTS = Object.freeze(["businessIdentity"] as const);

const SECTION_CODES: Readonly<Record<string, string>> = {
  businessIdentity: "COMPATIBILITY_SEO_IDENTITY_CHANGED",
  pages: "COMPATIBILITY_PAGE_SEO_CHANGED",
  generatedPages: "COMPATIBILITY_GENERATED_PAGE_SEO_CHANGED",
};

/** A section the schema gains without a code of its own still fails closed. */
const DEFAULT_SECTION_CODE = "COMPATIBILITY_SEO_CHANGED";

/** The field that names which page an SEO entry describes. */
const PAGE_ENTRY_KEY = "pageId";

function fail(code: string, message: string): never {
  throw new ManagedSiteContractError(code, message);
}

/** Every `internalSeo` section the schema declares that this rule compares. */
export function comparedSeoSections(): readonly string[] {
  const owned = new Set<string>(MANAGED_SEO_SECTIONS_WITH_THEIR_OWN_RULE);
  return Object.keys(managedSiteSeoDescriptorSchema.shape).filter((section) => !owned.has(section));
}

function normalized(path: string): string {
  return path.replace(/\[[^\]]*\]/gu, "[]");
}

/**
 * The lists in a section whose order is not identity: every list the
 * occurrence registry finds a reference in, since a list of references (a
 * page's services, a JSON-LD declaration's sources, its outline) names a set.
 * A list no reference passes through keeps its order.
 */
export function orderFreeSeoLists(section: string): ReadonlySet<string> {
  const prefix = `internalSeo.${section}`;
  const lists = new Set<string>();
  for (const entry of MANAGED_SITE_CONTRACT_OCCURRENCE_REGISTRY) {
    if (entry.role !== "reference" || !entry.path.startsWith(prefix)) continue;
    const relative = normalized(entry.path.slice(prefix.length)).replace(/^\[\]\.?|^\./u, "");
    const steps = relative.split("[]");
    for (let index = 1; index < steps.length; index += 1) lists.add(steps.slice(0, index).join("[]"));
  }
  return lists;
}

/** How a section is compared: which lists are order-free, what is not compared, whether nulls are open. */
export function seoFactRules(section: string): ManagedSeoFactRules {
  return {
    orderFree: orderFreeSeoLists(section),
    notCompared: new Set<string>(MANAGED_SEO_FACTS_NOT_COMPARED),
    openNull: (MANAGED_SEO_SECTIONS_WITH_OPEN_SLOTS as readonly string[]).includes(section),
  };
}

function isKeyedEntry(item: unknown): item is Readonly<Record<string, unknown>> {
  return item !== null && typeof item === "object" && typeof (item as Record<string, unknown>)[PAGE_ENTRY_KEY] === "string";
}

/** A section's entries: one per page for a list of page entries, else the section whole. */
function entriesOf(contract: ManagedSiteContractV1, section: string): ReadonlyMap<string, unknown> {
  const value = (contract.internalSeo as Readonly<Record<string, unknown>>)[section];
  if (Array.isArray(value) && value.every(isKeyedEntry)) {
    return new Map(value.map((entry) => [entry[PAGE_ENTRY_KEY] as string, entry]));
  }
  return new Map([[section, value]]);
}

function compareSection(
  section: string,
  production: ManagedSiteContractV1,
  candidate: ManagedSiteContractV1,
): ManagedSiteSeoReorderV1[] {
  const rules = seoFactRules(section);
  const code = SECTION_CODES[section] ?? DEFAULT_SECTION_CODE;
  const candidateEntries = entriesOf(candidate, section);
  return [...entriesOf(production, section)].flatMap(([key, entry]) => {
    const next = candidateEntries.get(key);
    if (next === undefined && entry !== undefined) fail(code, `SEO entry removed: ${section} ${key}`);
    if (!isPreservedBy(entry, next, rules)) fail(code, `SEO facts changed: ${section} ${key}`);
    const display = key === section ? `internalSeo.${section}` : `internalSeo.${section}[${key}]`;
    return collectSeoReorders(entry, next, { rules, path: "", display });
  });
}

/**
 * Every production SEO fact, outside the sections another rule owns and the
 * facts explicitly not compared, is kept. A code change may add a fact, and
 * may reorder a list whose order is not identity, which is returned to be
 * listed; it may not change, drop or fill one. `renames` is empty for an
 * ordinary change; a declared migration maps each field it retires to its
 * target, so production's facts are read with the migration applied: renamed
 * at every global field reference the occurrence registry declares, and
 * nowhere else, so any other string is compared verbatim.
 */
export function assertProductionSeoIdentityPreserved(
  production: ManagedSiteContractV1,
  candidate: ManagedSiteContractV1,
  renames: ReadonlyMap<string, string>,
): readonly ManagedSiteSeoReorderV1[] {
  const migrated = managedSiteContractWithRenamedFieldReferences(production, renames);
  const reorders = comparedSeoSections().flatMap((section) => compareSection(section, migrated, candidate));
  return Object.freeze(reorders.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0)));
}
