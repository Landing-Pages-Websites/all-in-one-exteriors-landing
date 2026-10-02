import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ManagedSiteContractV1 } from "../src/contract.js";
import { assertManagedSiteFieldMigrationReferencesV1 } from "../src/field-migration-references.js";
import type { ManagedSiteFieldMigrationResolvedStepV1 } from "../src/field-migration-steps.js";

const S1 = "field_s1";
const S2 = "field_s2";
const T = "field_t";
const OTHER = "field_other";

const steps = [{
  step: { op: "merge", target: T, into: { type: "rich_text", block: { type: "heading", level: 2 } }, parts: [] },
  sources: [{ id: S1 }, { id: S2 }],
}] as unknown as readonly ManagedSiteFieldMigrationResolvedStepV1[];

type Seo = Record<string, unknown>;

function contract(seo: Seo, atomicAliasGroups: unknown[] = []): ManagedSiteContractV1 {
  return {
    internalSeo: { businessIdentity: { legalName: OTHER }, pages: [], generatedPages: [], redirects: [], protectedFields: [], ...seo },
    pages: [],
    collections: [],
    assets: [],
    atomicAliasGroups,
    tombstonedIds: [],
  } as unknown as ManagedSiteContractV1;
}

function page(pageId: string, headingOutline: unknown[], extra: Seo = {}): Seo {
  return { pageId, headingOutline, jsonLd: [], intent: { primaryEntity: OTHER, services: [], locations: [] }, ...extra };
}

const at = (fieldId: string, semanticLevel: number) => ({ fieldId, semanticLevel });
const OTHER2 = "field_other2";
const alias = (...fieldIds: string[]) => ({ id: `alias_${fieldIds.join("_")}`, fieldIds });

function codeOf(production: ManagedSiteContractV1, candidate: ManagedSiteContractV1): string | undefined {
  try {
    assertManagedSiteFieldMigrationReferencesV1(production, candidate, steps);
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

const generatedJsonLd = (id: string) => ({
  generatedPages: [{ pageId: "page_g", collectionId: "collection_c", headingOutline: [], jsonLd: [{ siteSourceFieldIds: [id], itemSourceFieldIds: [] }] }],
});

describe("migration references, through the occurrence registry", () => {
  const cases: readonly [string, ManagedSiteContractV1, ManagedSiteContractV1, string | undefined][] = [
    ["an outline entry renamed in place",
      contract({ pages: [page("p", [at(OTHER, 2), at(S1, 2)])] }),
      contract({ pages: [page("p", [at(OTHER, 2), at(T, 2)])] }), undefined],
    ["the outline's page moved in the list",
      contract({ pages: [page("q", []), page("p", [at(S1, 2)])] }),
      contract({ pages: [page("p", [at(T, 2)]), page("q", [])] }), undefined],
    ["an unrelated SEO fact changed", contract({ pages: [page("p", [at(S1, 2)])] }),
      contract({ pages: [page("p", [at(T, 2)], { sitemap: { priority: 0.1 } })] }), undefined],
    ["an unrelated heading added to the same outline",
      contract({ pages: [page("p", [at(S1, 2)])] }),
      contract({ pages: [page("p", [at(OTHER2, 2), at(T, 2), at(OTHER, 3)])] }), undefined],
    ["an unrelated entry's level changed in the same outline",
      contract({ pages: [page("p", [at(OTHER, 2), at(S1, 2)])] }),
      contract({ pages: [page("p", [at(OTHER, 3), at(T, 2)])] }), undefined],
    ["an unrelated entry removed from the same outline",
      contract({ pages: [page("p", [at(OTHER, 2), at(S1, 2)])] }),
      contract({ pages: [page("p", [at(T, 2)])] }), undefined],
    ["the target moved to another page's outline",
      contract({ pages: [page("p", [at(S1, 2)]), page("q", [])] }),
      contract({ pages: [page("p", []), page("q", [at(T, 2)])] }), "MIGRATION_REFERENCE_CHANGED"],
    ["two sources in one outline",
      contract({ pages: [page("p", [at(S1, 2), at(S2, 2)])] }),
      contract({ pages: [page("p", [at(T, 2)])] }), "MIGRATION_SOURCE_STRUCTURE_LOST"],
    ["a target at a level it does not render",
      contract({ pages: [page("p", [at(S1, 3)])] }),
      contract({ pages: [page("p", [at(T, 3)])] }), "MIGRATION_OUTLINE_LEVEL_MISMATCH"],
    ["a source named by generated-page JSON-LD", contract(generatedJsonLd(S1)), contract(generatedJsonLd(T)), "MIGRATION_TRANSFORM_DEFERRED"],
    ["a source named by business identity",
      contract({ businessIdentity: { legalName: S1 } }), contract({ businessIdentity: { legalName: T } }), "MIGRATION_TRANSFORM_DEFERRED"],
    ["a source named as a page's service",
      contract({ pages: [page("p", [], { intent: { primaryEntity: OTHER, services: [S2], locations: [] } })] }),
      contract({ pages: [page("p", [], { intent: { primaryEntity: OTHER, services: [T], locations: [] } })] }), "MIGRATION_TRANSFORM_DEFERRED"],
    ["an unrelated alias group on both sides",
      contract({ pages: [page("p", [at(S1, 2)])] }, [alias(OTHER, OTHER2)]),
      contract({ pages: [page("p", [at(T, 2)])] }, [alias(OTHER, OTHER2)]), undefined],
    ["an unrelated alias group added by the candidate",
      contract({ pages: [page("p", [at(S1, 2)])] }),
      contract({ pages: [page("p", [at(T, 2)])] }, [alias(OTHER, OTHER2)]), undefined],
    ["an unrelated alias group and no outline at all",
      contract({}, [alias(OTHER, OTHER2)]), contract({}, [alias(OTHER, OTHER2)]), undefined],
    ["a target newly named by an alias group",
      contract({}, [alias(OTHER, OTHER2)]), contract({}, [alias(OTHER, T)]), "MIGRATION_REFERENCE_CHANGED"],
    ["a source named by an alias group",
      contract({}, [alias(OTHER, S1)]), contract({}, [alias(OTHER, T)]), "MIGRATION_TRANSFORM_DEFERRED"],
    ["a target newly named by JSON-LD", contract({}), contract(generatedJsonLd(T)), "MIGRATION_REFERENCE_CHANGED"],
    ["a target newly named by business identity",
      contract({}), contract({ businessIdentity: { legalName: T } }), "MIGRATION_REFERENCE_CHANGED"],
    // Only the registered `fieldId` of an outline entry is a reference; any
    // other string equal to a source is compared verbatim.
    ["an outline entry key other than fieldId renamed with it",
      contract({ pages: [page("p", [{ ...at(S1, 2), label: S1 }])] }),
      contract({ pages: [page("p", [{ ...at(T, 2), label: T }])] }), "MIGRATION_REFERENCE_CHANGED"],
    ["a nested literal in an outline entry renamed with it",
      contract({ pages: [page("p", [{ ...at(S1, 2), notes: [{ text: [S1] }] }])] }),
      contract({ pages: [page("p", [{ ...at(T, 2), notes: [{ text: [T] }] }])] }), "MIGRATION_REFERENCE_CHANGED"],
    ["an outline entry key other than fieldId kept verbatim",
      contract({ pages: [page("p", [{ ...at(S1, 2), label: S1 }])] }),
      contract({ pages: [page("p", [{ ...at(T, 2), label: S1 }])] }), undefined],
  ];
  for (const [name, production, candidate, code] of cases) {
    it(`${code ?? "accepts"}: ${name}`, () => assert.equal(codeOf(production, candidate), code));
  }
});

describe("structured plain-text roles", () => {
  it("are the schema's roles minus running text, so a new role is structured", async () => {
    const { MANAGED_PLAIN_TEXT_SEMANTICS } = await import("../src/fields.js");
    const { MANAGED_SITE_FIELD_MIGRATION_STRUCTURED_ROLES } = await import("../src/field-migration-steps.js");
    assert.deepEqual(
      [...MANAGED_SITE_FIELD_MIGRATION_STRUCTURED_ROLES].sort(),
      MANAGED_PLAIN_TEXT_SEMANTICS.filter((role) => !["body", "label", "caption"].includes(role)).sort(),
    );
    assert.ok(MANAGED_SITE_FIELD_MIGRATION_STRUCTURED_ROLES.includes("phone"));
    assert.ok(MANAGED_SITE_FIELD_MIGRATION_STRUCTURED_ROLES.includes("seo_title"));
  });
});

describe("outline order among migrated entries", () => {
  const T2 = "field_t2";
  const S3 = "field_s3";
  const twoSteps = [
    ...steps,
    {
      step: { op: "merge", target: T2, into: { type: "rich_text", block: { type: "heading", level: 2 } }, parts: [] },
      sources: [{ id: S3 }],
    },
  ] as unknown as readonly ManagedSiteFieldMigrationResolvedStepV1[];

  function reorders(production: ManagedSiteContractV1, candidate: ManagedSiteContractV1) {
    return assertManagedSiteFieldMigrationReferencesV1(production, candidate, twoSteps);
  }

  // Where migrated entries sit is listed by the ordinary SEO rule, which the
  // migration runs with production renamed (field-migration-urls-seo.test.ts),
  // so this rule only checks they are all there, at their levels.
  it("admits two targets that swap places in an outline", () => {
    assert.doesNotThrow(() =>
      reorders(contract({ pages: [page("p", [at(S1, 2), at(S3, 2)])] }), contract({ pages: [page("p", [at(T2, 2), at(T, 2)])] })));
  });

  it("admits targets kept in order around unrelated entries", () => {
    assert.doesNotThrow(() =>
      reorders(contract({ pages: [page("p", [at(S1, 2), at(OTHER, 2), at(S3, 2)])] }),
        contract({ pages: [page("p", [at(T, 2), at(T2, 2), at(OTHER, 3)])] })));
  });

  it("still refuses a swap that also changes a level", () => {
    assert.throws(
      () => reorders(contract({ pages: [page("p", [at(S1, 2), at(S3, 2)])] }), contract({ pages: [page("p", [at(T2, 2), at(T, 3)])] })),
      { code: "MIGRATION_OUTLINE_LEVEL_MISMATCH" },
    );
  });
});
