import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { assertProductionSeoIdentityPreserved } from "../src/contract-compatibility-seo.js";
import type { ManagedSiteContractV1 } from "../src/contract.js";

/**
 * A declared migration reads production with each retired field renamed to
 * its target, but only where the occurrence registry declares a global field
 * reference. Every row builds production with `OLD` and the candidate with
 * `NEW` at the same place, then compares them under the rename OLD -> NEW: a
 * registered field reference passes, and any other string equal to the
 * retired id (a JSON-LD literal, a page or asset reference, a key the
 * registry does not know) is compared verbatim and fails.
 */

const OLD = "field_old";
const NEW = "field_new";
const KEEP = "field_keep";
const RENAMES: ReadonlyMap<string, string> = new Map([[OLD, NEW]]);

type Json = Record<string, unknown>;
type Build = (id: string) => Json;

function jsonLd(overrides: Json = {}): Json {
  return { schemaType: "LocalBusiness", required: true, sourceFieldIds: [KEEP], requiredOutputProperties: ["name"], ...overrides };
}

function generatedJsonLd(overrides: Json = {}): Json {
  return {
    schemaType: "Service",
    required: true,
    itemSourceFieldIds: [],
    siteSourceFieldIds: [KEEP],
    requiredOutputProperties: ["name"],
    ...overrides,
  };
}

function shared(overrides: Json): Json {
  return {
    intent: { purpose: "service", primaryEntity: KEEP, services: [], locations: [] },
    headingOutline: [],
    breadcrumbParentPageId: null,
    internalLinks: { requiredPageIds: [], minimumInboundLinks: 0 },
    sitemap: { included: true, changeFrequency: "monthly", priority: 0.5 },
    performanceBudget: { maxLcpMilliseconds: 2500, maxCls: 0.1, maxInpMilliseconds: 200, maxPageBytes: 1000000 },
    ...overrides,
  };
}

function metadata(overrides: Json = {}, social: Json = {}): Json {
  return {
    title: KEEP,
    description: KEEP,
    canonical: KEEP,
    indexing: KEEP,
    social: { title: null, description: null, image: null, ...social },
    ...overrides,
  };
}

function page(overrides: Json = {}): Json {
  return shared({ pageId: "page_p", metadata: metadata(), jsonLd: [jsonLd()], primaryImageAssetSlotId: null, ...overrides });
}

function generatedPage(overrides: Json = {}): Json {
  return shared({
    pageId: "page_g",
    collectionId: "collection_c",
    metadata: { title: KEEP, description: KEEP, canonical: KEEP, indexing: KEEP, social: { title: null, description: null, imageFieldId: null } },
    jsonLd: [generatedJsonLd()],
    primaryImageFieldId: null,
    ...overrides,
  });
}

function identity(overrides: Json = {}): Json {
  return {
    legalName: KEEP,
    displayName: KEEP,
    telephone: KEEP,
    postalAddress: null,
    email: null,
    geo: null,
    openingHours: null,
    sameAs: null,
    ...overrides,
  };
}

function contract(seo: Json): ManagedSiteContractV1 {
  return {
    internalSeo: { protectedFields: [], businessIdentity: identity(), pages: [page()], generatedPages: [generatedPage()], redirects: [], ...seo },
    pages: [],
    collections: [],
    assets: [],
    atomicAliasGroups: [],
    tombstonedIds: [],
  } as unknown as ManagedSiteContractV1;
}

const onPage = (overrides: (id: string) => Json): Build => (id) => ({ pages: [page(overrides(id))] });
const onGenerated = (overrides: (id: string) => Json): Build => (id) => ({ generatedPages: [generatedPage(overrides(id))] });
const onIdentity = (overrides: (id: string) => Json): Build => (id) => ({ businessIdentity: identity(overrides(id)) });

const PAGE_CHANGED = "COMPATIBILITY_PAGE_SEO_CHANGED";
const GENERATED_CHANGED = "COMPATIBILITY_GENERATED_PAGE_SEO_CHANGED";
const IDENTITY_CHANGED = "COMPATIBILITY_SEO_IDENTITY_CHANGED";

type Row = readonly [name: string, build: Build, code: string | undefined];

/** Strings equal to the retired id at a place that is not a global field reference. */
const literals: readonly Row[] = [
  ["a JSON-LD requiredOutputProperties literal", onPage((id) => ({ jsonLd: [jsonLd({ requiredOutputProperties: [id] })] })), PAGE_CHANGED],
  ["a JSON-LD schemaType literal", onPage((id) => ({ jsonLd: [jsonLd({ schemaType: id })] })), PAGE_CHANGED],
  ["a JSON-LD output property beside a genuine source rename",
    onPage((id) => ({ jsonLd: [jsonLd({ sourceFieldIds: [id], requiredOutputProperties: [id] })] })), PAGE_CHANGED],
  ["a generated JSON-LD requiredOutputProperties literal",
    onGenerated((id) => ({ jsonLd: [generatedJsonLd({ requiredOutputProperties: ["name", id] })] })), GENERATED_CHANGED],
  ["a generated JSON-LD schemaType literal", onGenerated((id) => ({ jsonLd: [generatedJsonLd({ schemaType: id })] })), GENERATED_CHANGED],
  ["an asset reference in metadata.social.image", onPage((id) => ({ metadata: metadata({}, { image: id }) })), PAGE_CHANGED],
  ["a metadata key the registry does not declare", onPage((id) => ({ metadata: { ...metadata(), label: id } })), PAGE_CHANGED],
  ["an intent key the registry does not declare", onPage((id) => ({ intent: { purpose: "service", primaryEntity: KEEP, services: [], locations: [], label: id } })), PAGE_CHANGED],
  ["a page reference in breadcrumbParentPageId", onPage((id) => ({ breadcrumbParentPageId: id })), PAGE_CHANGED],
  ["a page reference in internalLinks.requiredPageIds", onPage((id) => ({ internalLinks: { requiredPageIds: [id], minimumInboundLinks: 0 } })), PAGE_CHANGED],
  ["an asset reference in primaryImageAssetSlotId", onPage((id) => ({ primaryImageAssetSlotId: id })), PAGE_CHANGED],
  ["a nested object literal under a JSON-LD declaration", onPage((id) => ({ jsonLd: [jsonLd({ extra: { nested: { deeper: id } } })] })), PAGE_CHANGED],
  ["a nested array literal beside an outline entry",
    onPage((id) => ({ headingOutline: [{ fieldId: KEEP, semanticLevel: 2, notes: [[id]] }] })), PAGE_CHANGED],
  ["an outline entry key other than fieldId", onPage((id) => ({ headingOutline: [{ fieldId: KEEP, semanticLevel: 2, label: id }] })), PAGE_CHANGED],
  ["a business identity key the registry does not declare", onIdentity((id) => ({ note: id })), IDENTITY_CHANGED],
  ["a generated page's collection reference", onGenerated((id) => ({ collectionId: id })), GENERATED_CHANGED],
  // Route-collection references name item fields, which a migration never retires.
  ["a generated page's route-collection intent reference", onGenerated((id) => ({
    intent: { purpose: "service", primaryEntity: id, services: [], locations: [] },
  })), GENERATED_CHANGED],
  ["a generated page's item JSON-LD source", onGenerated((id) => ({ jsonLd: [generatedJsonLd({ itemSourceFieldIds: [id] })] })), GENERATED_CHANGED],
  ["a generated page's route-collection outline entry", onGenerated((id) => ({ headingOutline: [{ fieldId: id, semanticLevel: 2 }] })), GENERATED_CHANGED],
];

/** The retired id at a global field reference the registry declares. */
const references: readonly Row[] = [
  ["a JSON-LD sourceFieldIds entry", onPage((id) => ({ jsonLd: [jsonLd({ sourceFieldIds: [KEEP, id] })] })), undefined],
  ["a headingOutline fieldId", onPage((id) => ({ headingOutline: [{ fieldId: id, semanticLevel: 2 }] })), undefined],
  ["metadata.title", onPage((id) => ({ metadata: metadata({ title: id }) })), undefined],
  ["metadata.description", onPage((id) => ({ metadata: metadata({ description: id }) })), undefined],
  ["metadata.canonical", onPage((id) => ({ metadata: metadata({ canonical: id }) })), undefined],
  ["metadata.indexing", onPage((id) => ({ metadata: metadata({ indexing: id }) })), undefined],
  ["metadata.social.title", onPage((id) => ({ metadata: metadata({}, { title: id }) })), undefined],
  ["metadata.social.description", onPage((id) => ({ metadata: metadata({}, { description: id }) })), undefined],
  ["metadata.social.imageFieldId", onPage((id) => ({ metadata: metadata({}, { imageFieldId: id }) })), undefined],
  ["intent.primaryEntity, services and locations", onPage((id) => ({
    intent: { purpose: "service", primaryEntity: id, services: [id], locations: [KEEP, id] },
  })), undefined],
  ["business identity legalName and email", onIdentity((id) => ({ legalName: id, email: id })), undefined],
  ["every other business identity key", onIdentity((id) => ({
    displayName: id, telephone: id, postalAddress: id, geo: id, openingHours: id, sameAs: id,
  })), undefined],
  ["a generated page's site JSON-LD source", onGenerated((id) => ({ jsonLd: [generatedJsonLd({ siteSourceFieldIds: [id] })] })), undefined],
  ["a JSON-LD source renamed beside an unrelated output property",
    onPage((id) => ({ jsonLd: [jsonLd({ sourceFieldIds: [id], requiredOutputProperties: ["name", "telephone"] })] })), undefined],
];

function outcome(build: Build, candidateId = NEW): string | undefined {
  try {
    assertProductionSeoIdentityPreserved(contract(build(OLD)), contract(build(candidateId)), RENAMES);
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

/** The section code a registered reference row fails with when the candidate keeps the retired id. */
function staleCode(build: Build): string {
  const changed = Object.keys(build(OLD))[0];
  if (changed === "businessIdentity") return IDENTITY_CHANGED;
  return changed === "generatedPages" ? GENERATED_CHANGED : PAGE_CHANGED;
}

describe("a migration renames production SEO only at registered global field references", () => {
  for (const [name, build, code] of [...literals, ...references]) {
    it(`${code ?? "accepts"}: ${name}`, () => assert.equal(outcome(build), code));
  }

  // Production reads as the target at a registered reference, so a candidate
  // that still names the retired field there has changed it.
  for (const [name, build] of references) {
    it(`${staleCode(build)}: ${name}, still naming the retired field`, () => assert.equal(outcome(build, OLD), staleCode(build)));
  }

  it("leaves the production contract it reads untouched", () => {
    const production = contract(onPage((id) => ({ headingOutline: [{ fieldId: id, semanticLevel: 2 }] }))(OLD));
    const before = structuredClone(production);
    assertProductionSeoIdentityPreserved(production, contract(onPage((id) => ({ headingOutline: [{ fieldId: id, semanticLevel: 2 }] }))(NEW)), RENAMES);
    assert.deepEqual(production, before);
  });

  it("keeps production unrenamed when the candidate leaves a literal alone", () => {
    const build = onPage(() => ({ jsonLd: [jsonLd({ requiredOutputProperties: [OLD] })] }));
    assert.doesNotThrow(() => assertProductionSeoIdentityPreserved(contract(build(OLD)), contract(build(OLD)), RENAMES));
  });
});
