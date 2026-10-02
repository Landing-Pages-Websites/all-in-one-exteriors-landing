import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ManagedSiteContractError,
  parseManagedSiteContentDocument,
  parseManagedSiteContractV1,
  validateManagedSiteContractV1Compatibility,
  validateManagedSiteContractV1ContentSemantics,
  validateManagedSiteContractV1Semantics,
} from "../src/index.js";
import { contentSemanticsFixture } from "./content-semantics-fixture.js";
import {
  contentValue,
  editableSeoFixture,
  internalSeo,
  legacyMetadataFor,
  metadata,
  object,
  objects,
  renderedField,
  seoPage,
  seoTextField,
  social,
  socialImageValue,
  type EditableSeoFixture,
  type JsonObject,
} from "./editable-seo-fixture.js";
import { fixtureId } from "./contract-semantics-fixture.js";

type Mutation = (fixture: EditableSeoFixture) => void;

interface Case {
  readonly name: string;
  readonly mutate: Mutation;
  /** Refused by an earlier, pre-existing rule rather than the SEO field policy. */
  readonly code?: string;
}

const POLICY = "CONTRACT_SEO_FIELD_POLICY";

function codeOf(action: () => unknown): string {
  try {
    action();
  } catch (error) {
    if (error instanceof ManagedSiteContractError) return error.code;
    throw error;
  }
  return "ACCEPTED";
}

function validateContract(fixture: EditableSeoFixture): void {
  validateManagedSiteContractV1Semantics(parseManagedSiteContractV1(fixture.contract));
}

function validateContent(fixture: EditableSeoFixture): void {
  validateManagedSiteContractV1ContentSemantics(
    parseManagedSiteContractV1(fixture.contract),
    parseManagedSiteContentDocument(fixture.content),
  );
}

function mutated(mutate: Mutation): EditableSeoFixture {
  const fixture = editableSeoFixture();
  mutate(fixture);
  return fixture;
}

function homeSections(fixture: EditableSeoFixture): JsonObject[] {
  return objects(objects(fixture.contract.pages)[0].sections);
}

function constraints(fixture: EditableSeoFixture, fieldId: string): JsonObject {
  return object(renderedField(fixture, fieldId).constraints);
}

function collectionItemFields(fixture: EditableSeoFixture): JsonObject[] {
  return objects(objects(fixture.contract.collections)[0].itemFields);
}

/** Back to every site's shape today: protected title and description, no editable SEO. */
function toLegacy(fixture: EditableSeoFixture): void {
  const { ids } = fixture;
  seoPage(fixture, ids.homePage).metadata = legacyMetadataFor(fixture);
  seoPage(fixture, ids.aboutPage).metadata = legacyMetadataFor(fixture);
  const editable = new Set([ids.homeTitle, ids.homeDescription, ids.homeImage, ids.aboutTitle, ids.aboutDescription, ids.aboutImage]);
  for (const page of objects(fixture.contract.pages)) {
    page.sections = objects(page.sections).filter(
      (section) => !objects(section.fields).some((field) => editable.has(field.id as string)),
    );
  }
  fixture.content.values = objects(fixture.content.values).filter((value) => !editable.has(value.fieldId as string));
  fixture.content.assetManifest = objects(fixture.content.assetManifest).filter((entry) => entry.assetSlotId !== ids.socialAsset);
  fixture.contract.assets = objects(fixture.contract.assets).filter((asset) => asset.id !== ids.socialAsset);
}

describe("editable per-page SEO: accepted shapes", () => {
  const accepted: readonly Case[] = [
    { name: "editable title, description and share image on two pages", mutate: () => {} },
    { name: "legacy protected title and description (every site today)", mutate: toLegacy },
    {
      name: "editable title beside a legacy protected description",
      mutate: (fixture) => {
        metadata(fixture, fixture.ids.homePage).description = fixture.ids.protectedDescription;
        homeSections(fixture)[1].fields = objects(homeSections(fixture)[1].fields).filter(
          (field) => field.id !== fixture.ids.homeDescription,
        );
        fixture.content.values = objects(fixture.content.values).filter((value) => value.fieldId !== fixture.ids.homeDescription);
      },
    },
    {
      name: "social title and description naming the page's own editable fields",
      mutate: (fixture) => {
        social(fixture, fixture.ids.homePage).title = fixture.ids.homeTitle;
        social(fixture, fixture.ids.homePage).description = fixture.ids.homeDescription;
      },
    },
    {
      name: "social title and description naming the legacy protected fields",
      mutate: (fixture) => {
        social(fixture, fixture.ids.homePage).title = fixture.ids.protectedTitle;
        social(fixture, fixture.ids.homePage).description = fixture.ids.protectedDescription;
      },
    },
    {
      name: "the largest admitted length (320)",
      mutate: (fixture) => {
        constraints(fixture, fixture.ids.homeTitle).maxLength = 320;
        constraints(fixture, fixture.ids.homeDescription).maxLength = 320;
      },
    },
    {
      name: "a shipped 216-character description kept at its own length",
      mutate: (fixture) => {
        constraints(fixture, fixture.ids.homeDescription).maxLength = 216;
        contentValue(fixture, fixture.ids.homeDescription).value = "d".repeat(216);
      },
    },
    {
      name: "an empty title and a whitespace-only description (the site falls back)",
      mutate: (fixture) => {
        contentValue(fixture, fixture.ids.homeTitle).value = "";
        contentValue(fixture, fixture.ids.homeDescription).value = "   ";
      },
    },
    {
      name: "no share image field: the slot alone, as before",
      mutate: (fixture) => {
        delete social(fixture, fixture.ids.aboutPage).imageFieldId;
        social(fixture, fixture.ids.aboutPage).image = null;
      },
    },
  ];
  for (const { name, mutate } of accepted) {
    it(`accepts ${name}`, () => {
      const fixture = mutated(mutate);
      assert.equal(codeOf(() => validateContract(fixture)), "ACCEPTED");
      assert.equal(codeOf(() => validateContent(fixture)), "ACCEPTED");
    });
  }
});

function titleCases(): readonly Case[] {
  return [
    { name: "title names a body field", mutate: (f) => { metadata(f, f.ids.homePage).title = f.ids.bodyField; } },
    { name: "title names the page's description field", mutate: (f) => { metadata(f, f.ids.homePage).title = f.ids.homeDescription; } },
    { name: "description names the page's title field", mutate: (f) => { metadata(f, f.ids.homePage).description = f.ids.homeTitle; } },
    { name: "title names another page's title field", mutate: (f) => { metadata(f, f.ids.homePage).title = f.ids.aboutTitle; } },
    { name: "description names another page's description field", mutate: (f) => { metadata(f, f.ids.homePage).description = f.ids.aboutDescription; } },
    { name: "title names a protected description", mutate: (f) => { metadata(f, f.ids.homePage).title = f.ids.protectedDescription; } },
    { name: "description names a protected title", mutate: (f) => { metadata(f, f.ids.homePage).description = f.ids.protectedTitle; } },
    { name: "title names a protected canonical", mutate: (f) => { metadata(f, f.ids.homePage).title = f.ids.protectedCanonical; } },
    { name: "social title names a body field", mutate: (f) => { social(f, f.ids.homePage).title = f.ids.bodyField; } },
    { name: "social title names another page's title field", mutate: (f) => { social(f, f.ids.homePage).title = f.ids.aboutTitle; } },
    { name: "social description names the page's title field", mutate: (f) => { social(f, f.ids.homePage).description = f.ids.homeTitle; } },
  ];
}

/** On a legacy page, so only the protected target rule can refuse them. */
function legacyTargetCases(): readonly Case[] {
  const legacy = (edit: Mutation): Mutation => (f) => { toLegacy(f); edit(f); };
  return [
    { name: "title names the protected description", mutate: legacy((f) => { metadata(f, f.ids.homePage).title = f.ids.protectedDescription; }) },
    { name: "description names the protected title", mutate: legacy((f) => { metadata(f, f.ids.homePage).description = f.ids.protectedTitle; }) },
    { name: "social title names the protected description", mutate: legacy((f) => { social(f, f.ids.homePage).title = f.ids.protectedDescription; }) },
    { name: "title names the protected canonical", mutate: legacy((f) => { metadata(f, f.ids.homePage).title = f.ids.protectedCanonical; }) },
    { name: "title names a body field", mutate: legacy((f) => { metadata(f, f.ids.homePage).title = f.ids.bodyField; }) },
    { name: "canonical names the protected title", mutate: legacy((f) => { metadata(f, f.ids.homePage).canonical = f.ids.protectedTitle; }) },
  ];
}

function fieldShapeCases(): readonly Case[] {
  return [
    {
      name: "title field is site-scoped",
      mutate: (f) => { renderedField(f, f.ids.homeTitle).scope = "site"; },
    },
    {
      name: "title field is used on two pages",
      mutate: (f) => {
        const field = renderedField(f, f.ids.homeTitle);
        field.scope = "site";
        field.usages = [{ pageId: f.ids.homePage, itemId: null }, { pageId: f.ids.aboutPage, itemId: null }];
      },
    },
    {
      name: "title field has two usages on its own page",
      mutate: (f) => {
        const home = f.ids.homePage;
        renderedField(f, f.ids.homeTitle).usages = [{ pageId: home, itemId: null }, { pageId: home, itemId: fixtureId("item") }];
      },
    },
    {
      name: "title field is declared on another page's section",
      mutate: (f) => {
        const [moved] = objects(homeSections(f)[1].fields).splice(0, 1);
        objects(objects(objects(f.contract.pages)[2].sections)[0].fields).push(moved);
      },
    },
    { name: "title allows newlines", mutate: (f) => { constraints(f, f.ids.homeTitle).newlines = "allow"; } },
    { name: "description allows newlines", mutate: (f) => { constraints(f, f.ids.homeDescription).newlines = "allow"; } },
    { name: "title maxLength 10000", mutate: (f) => { constraints(f, f.ids.homeTitle).maxLength = 10_000; } },
    { name: "description maxLength 321", mutate: (f) => { constraints(f, f.ids.homeDescription).maxLength = 321; } },
    { name: "title maxLength 321", mutate: (f) => { constraints(f, f.ids.homeTitle).maxLength = 321; } },
    {
      name: "title field is code-owned",
      mutate: (f) => {
        const field = renderedField(f, f.ids.homeTitle);
        field.classification = "code_owned_interface";
        field.capabilities = [];
      },
    },
  ];
}

function imageCases(): readonly Case[] {
  return [
    {
      name: "share image field is on a different slot",
      mutate: (f) => {
        renderedField(f, f.ids.homeImage).assetSlotId = objects(f.contract.assets)[0].id;
      },
    },
    { name: "share image field is another page's", mutate: (f) => { social(f, f.ids.homePage).imageFieldId = f.ids.aboutImage; } },
    { name: "share image field is a text field", mutate: (f) => { social(f, f.ids.homePage).imageFieldId = f.ids.homeTitle; } },
    { name: "share image field without a social slot", mutate: (f) => { social(f, f.ids.homePage).image = null; } },
    {
      name: "share image names the hero image (another slot)",
      mutate: (f) => {
        const hero = objects(objects(homeSections(f)[0].fields)).find((field) => field.type === "image");
        social(f, f.ids.homePage).imageFieldId = hero?.id;
      },
    },
    {
      name: "share image field is site-scoped",
      mutate: (f) => { renderedField(f, f.ids.homeImage).scope = "site"; },
    },
  ];
}

/** A share image field is named once, by its own page's imageFieldId, and nowhere else. */
function shareImageReferenceCases(): readonly Case[] {
  return [
    { name: "an atomic alias of two pages' share images", mutate: (f) => { objects(f.contract.atomicAliasGroups).push({ id: fixtureId("alias"), fieldIds: [f.ids.homeImage, f.ids.aboutImage] }); } },
    { name: "an atomic alias of the page's own share image", mutate: (f) => { objects(f.contract.atomicAliasGroups).push({ id: fixtureId("alias"), fieldIds: [f.ids.homeImage] }); } },
    { name: "the share image in the heading outline", mutate: (f) => { objects(seoPage(f, f.ids.homePage).headingOutline).push({ fieldId: f.ids.homeImage, semanticLevel: 2 }); } },
    { name: "the share image as a JSON-LD source", mutate: (f) => { objects(seoPage(f, f.ids.homePage).jsonLd)[0].sourceFieldIds = [f.ids.homeImage]; } },
    { name: "the share image as the page's primary entity", mutate: (f) => { object(seoPage(f, f.ids.homePage).intent).primaryEntity = f.ids.homeImage; } },
    { name: "the share image in business identity", mutate: (f) => { object(internalSeo(f).businessIdentity).sameAs = f.ids.homeImage; } },
    { name: "the share image as another page's service", mutate: (f) => { objects(object(seoPage(f, f.ids.aboutPage).intent).services).push(f.ids.homeImage); } },
    { name: "the share image named by two pages", mutate: (f) => { social(f, f.ids.aboutPage).imageFieldId = f.ids.homeImage; } },
  ];
}

function referenceCases(): readonly Case[] {
  return [
    {
      name: "a seo_title field no metadata names",
      mutate: (f) => { metadata(f, f.ids.homePage).title = f.ids.protectedTitle; },
    },
    {
      name: "a seo_title field named only by social title",
      mutate: (f) => {
        metadata(f, f.ids.homePage).title = f.ids.protectedTitle;
        social(f, f.ids.homePage).title = f.ids.homeTitle;
      },
    },
    { name: "a seo_title field in the heading outline", mutate: (f) => { objects(seoPage(f, f.ids.homePage).headingOutline).push({ fieldId: f.ids.homeTitle, semanticLevel: 2 }); } },
    { name: "a seo_description field as a JSON-LD source", mutate: (f) => { objects(seoPage(f, f.ids.homePage).jsonLd)[0].sourceFieldIds = [f.ids.homeDescription]; } },
    { name: "a seo_title field as the page's primary entity", mutate: (f) => { object(seoPage(f, f.ids.homePage).intent).primaryEntity = f.ids.homeTitle; } },
    { name: "a seo_title field in business identity", mutate: (f) => { object(internalSeo(f).businessIdentity).displayName = f.ids.homeTitle; } },
    {
      name: "a seo_title field in an atomic alias group",
      mutate: (f) => { objects(f.contract.atomicAliasGroups).push({ id: fixtureId("alias"), fieldIds: [f.ids.homeTitle] }); },
    },
    {
      name: "a seo_title semantic on a collection item field",
      mutate: (f) => {
        const item = collectionItemFields(f).find((field) => field.type === "heading_text");
        collectionItemFields(f).push({
          id: fixtureId("field"),
          type: "plain_text",
          classification: "customer_editable",
          capabilities: ["text.edit"],
          itemPointer: "/seoTitle",
          presentation: item?.presentation,
          semantic: "seo_title",
          constraints: { minLength: 0, maxLength: 70, newlines: "forbid" },
        });
      },
    },
  ];
}

function protectedOnlyCases(): readonly Case[] {
  const rendered = (f: EditableSeoFixture) => [f.ids.homeTitle, f.ids.bodyField, f.ids.protectedTitle];
  const cases: Case[] = [];
  for (const slot of ["canonical", "indexing"] as const) {
    for (const [index, label] of ["an editable SEO field", "a body field", "the protected title"].entries()) {
      cases.push({
        name: `${slot} names ${label}`,
        mutate: (f) => { metadata(f, f.ids.homePage)[slot] = rendered(f)[index]; },
      });
    }
  }
  cases.push(
    { name: "generated title names a rendered seo_title field", code: "CONTRACT_REFERENCE_SCOPE", mutate: (f) => { object(objects(internalSeo(f).generatedPages)[0].metadata).title = f.ids.homeTitle; } },
    { name: "generated social title names a rendered seo_title field", code: "CONTRACT_REFERENCE_SCOPE", mutate: (f) => { object(object(objects(internalSeo(f).generatedPages)[0].metadata).social).title = f.ids.homeTitle; } },
  );
  return cases;
}

describe("editable per-page SEO: refused contracts", () => {
  const groups: ReadonlyArray<readonly [string, readonly Case[]]> = [
    ["title and description targets", titleCases()],
    ["legacy protected targets", legacyTargetCases()],
    ["field shape", fieldShapeCases()],
    ["share image", imageCases()],
    ["share image references", shareImageReferenceCases()],
    ["references outside metadata", referenceCases()],
    ["protected-only slots", protectedOnlyCases()],
  ];
  for (const [group, cases] of groups) {
    for (const { name, mutate, code } of cases) {
      it(`${group}: refuses ${name}`, () => {
        const fixture = mutated(mutate);
        assert.equal(codeOf(() => validateContract(fixture)), code ?? POLICY);
      });
    }
  }
});

describe("editable per-page SEO: values", () => {
  const refused: ReadonlyArray<readonly [string, string]> = [
    ["a line feed", "Home\nGomega"],
    ["a carriage return", "Home\rGomega"],
    ["a tab", "Home\tGomega"],
    ["a bell", "Home\u0007Gomega"],
    ["DEL", "Home\u007fGomega"],
    ["a C1 control", "Home\u0085Gomega"],
    ["a right-to-left override", "Home‮Gomega"],
    ["a bidi isolate", "Home⁦Gomega"],
    ["a line separator", "Home Gomega"],
    ["a paragraph separator", "Home Gomega"],
    ["71 characters", "x".repeat(71)],
  ];
  for (const [label, value] of refused) {
    it(`refuses a title carrying ${label}`, () => {
      const fixture = editableSeoFixture();
      contentValue(fixture, fixture.ids.homeTitle).value = value;
      assert.equal(codeOf(() => validateContent(fixture)), "CONTENT_VALUE_POLICY");
    });
  }

  it("refuses a control character in a description too", () => {
    const fixture = editableSeoFixture();
    contentValue(fixture, fixture.ids.homeDescription).value = "About\u0000home.";
    assert.equal(codeOf(() => validateContent(fixture)), "CONTENT_VALUE_POLICY");
  });

  const EMOJI = "\u{1F600}";
  const measured: ReadonlyArray<readonly [string, string, number, string, string]> = [
    ["320 emoji at maxLength 320", "homeDescription", 320, EMOJI.repeat(320), "ACCEPTED"],
    ["321 emoji at maxLength 320", "homeDescription", 320, EMOJI.repeat(321), "CONTENT_VALUE_POLICY"],
    ["a 69-code-point title with 2 emoji (71 UTF-16 units) at maxLength 70", "homeTitle", 70, `${"t".repeat(67)}${EMOJI}${EMOJI}`, "ACCEPTED"],
    ["71 code points with 2 emoji at maxLength 70", "homeTitle", 70, `${"t".repeat(69)}${EMOJI}${EMOJI}`, "CONTENT_VALUE_POLICY"],
    ["120 emoji in a body field at maxLength 120", "bodyField", 120, EMOJI.repeat(120), "ACCEPTED"],
    ["121 emoji in a body field at maxLength 120", "bodyField", 120, EMOJI.repeat(121), "CONTENT_VALUE_POLICY"],
  ];
  for (const [label, key, maxLength, value, expected] of measured) {
    it(`measures plain text in code points: ${label}`, () => {
      const fixture = editableSeoFixture();
      const fieldId = fixture.ids[key as "homeTitle" | "homeDescription" | "bodyField"];
      constraints(fixture, fieldId).maxLength = maxLength;
      contentValue(fixture, fieldId).value = value;
      assert.equal(codeOf(() => validateContent(fixture)), expected);
    });
  }

  it("keeps admitting a value whose UTF-16 length meets minLength (one emoji, minLength 2)", () => {
    const fixture = editableSeoFixture();
    constraints(fixture, fixture.ids.bodyField).minLength = 2;
    contentValue(fixture, fixture.ids.bodyField).value = EMOJI;
    assert.equal(codeOf(() => validateContent(fixture)), "ACCEPTED");
  });

  it("keeps accepting a tab in an ordinary body field", () => {
    const fixture = editableSeoFixture();
    contentValue(fixture, fixture.ids.bodyField).value = "Managed\tbody";
    assert.equal(codeOf(() => validateContent(fixture)), "ACCEPTED");
  });
});

describe("editable per-page SEO: share images and CONTENT_SEO_IMAGE_AMBIGUOUS", () => {
  it("resolves each page's share image through its field, so a per-site slot with one entry per page is not ambiguous", () => {
    const fixture = editableSeoFixture();
    const socialEntries = objects(fixture.content.assetManifest).filter(
      (entry) => entry.assetSlotId === fixture.ids.socialAsset,
    );
    assert.equal(socialEntries.length, 2);
    assert.equal(codeOf(() => validateContent(fixture)), "ACCEPTED");
  });

  it("still refuses a page that names the per-site slot without a field", () => {
    const fixture = mutated((f) => { delete social(f, f.ids.aboutPage).imageFieldId; });
    assert.equal(codeOf(() => validateContent(fixture)), "CONTENT_SEO_IMAGE_AMBIGUOUS");
  });

  it("still refuses a primary image on the per-site slot", () => {
    const fixture = mutated((f) => { seoPage(f, f.ids.homePage).primaryImageAssetSlotId = f.ids.socialAsset; });
    assert.equal(codeOf(() => validateContent(fixture)), "CONTENT_SEO_IMAGE_AMBIGUOUS");
  });
});

describe("editable per-page SEO: compatibility", () => {
  function compatibilityCode(
    production: { readonly contract: JsonObject; readonly content: JsonObject },
    candidate: { readonly contract: JsonObject; readonly content: JsonObject },
  ): string {
    return codeOf(() =>
      validateManagedSiteContractV1Compatibility(
        parseManagedSiteContractV1(production.contract),
        parseManagedSiteContentDocument(production.content),
        parseManagedSiteContractV1(candidate.contract),
        parseManagedSiteContentDocument(candidate.content),
      ),
    );
  }

  const homeSocialOf = (f: { readonly contract: JsonObject; readonly ids: { readonly homePage: string } }) =>
    object(metadata(f, f.ids.homePage).social);

  type Pair = { readonly contract: JsonObject; readonly content: JsonObject; readonly ids: EditableSeoFixture["ids"] };

  const PAGE_TITLE_ID = `field_${"7".repeat(25)}0`;
  const EDITABLE_TITLE_ID = `field_${"6".repeat(25)}0`;
  const EDITABLE_DESCRIPTION_ID = `field_${"5".repeat(25)}0`;
  const CLONED_TITLE_ID = `field_${"8".repeat(25)}0`;

  /**
   * A production home page the way a converted site has it: a page-scoped
   * protected title and description, each echoed by its share card, so the
   * card keeps its own text.
   */
  function productionHome(): Pair {
    const base = contentSemanticsFixture();
    const description = objects(internalSeo(base).protectedFields).find(
      (field) => field.id === base.ids.protectedDescriptionField,
    );
    if (description === undefined) throw new Error("Missing protected description");
    objects(internalSeo(base).protectedFields).push({
      ...structuredClone(description),
      id: PAGE_TITLE_ID,
      semantic: "seo.title",
      resolver: { kind: "json_pointer", path: "content/site.json", pointer: "/seo/pageTitle" },
    });
    objects(base.content.values).push({
      ...structuredClone(contentValue(base, base.ids.protectedDescriptionField)),
      fieldId: PAGE_TITLE_ID,
      value: "Home | Gomega",
    });
    const home = metadata(base, base.ids.homePage);
    home.title = PAGE_TITLE_ID;
    home.social = { ...object(home.social), title: PAGE_TITLE_ID, description: home.description };
    return { ...base, ids: { ...editableSeoFixture().ids, homePage: base.ids.homePage } };
  }

  /** The production pair with the home title and description adopted by new editable fields. */
  function adoptEditableHomeSeo(production: Pair): Pair {
    const candidate = structuredClone(production) as Pair;
    const home = metadata(candidate, candidate.ids.homePage);
    const served = (fieldId: string) => contentValue(production, fieldId).value;
    objects(objects(candidate.contract.pages)[0].sections).push({
      id: `section_${"4".repeat(25)}0`,
      presentation: { name: "Search & sharing", description: null, group: "Search & sharing", order: 99, example: null },
      fields: [
        seoTextField(EDITABLE_TITLE_ID, candidate.ids.homePage, "seo_title", "/meta/home/title"),
        seoTextField(EDITABLE_DESCRIPTION_ID, candidate.ids.homePage, "seo_description", "/meta/home/description"),
      ],
    });
    const owner = { kind: "page", pageId: candidate.ids.homePage };
    objects(candidate.content.values).push(
      { fieldId: EDITABLE_TITLE_ID, owner, type: "plain_text", value: served(home.title as string) },
      { fieldId: EDITABLE_DESCRIPTION_ID, owner, type: "plain_text", value: served(home.description as string) },
    );
    home.title = EDITABLE_TITLE_ID;
    home.description = EDITABLE_DESCRIPTION_ID;
    return candidate;
  }

  it("admits re-pointing a production title and description to editable fields serving the same text", () => {
    const production = productionHome();
    const candidate = adoptEditableHomeSeo(production);
    assert.equal(compatibilityCode(production, candidate), "ACCEPTED");
    const result = validateManagedSiteContractV1Compatibility(
      parseManagedSiteContractV1(production.contract),
      parseManagedSiteContentDocument(production.content),
      parseManagedSiteContractV1(candidate.contract),
      parseManagedSiteContentDocument(candidate.content),
    );
    for (const id of [EDITABLE_TITLE_ID, EDITABLE_DESCRIPTION_ID]) {
      assert.ok(result.addedStableIds.includes(id as never));
    }
  });

  it("admits the adoption with echoes set to the protected fields in the same change, as converted sites have none", () => {
    const production = productionHome();
    homeSocialOf(production).title = null;
    homeSocialOf(production).description = null;
    const candidate = adoptEditableHomeSeo(production);
    homeSocialOf(candidate).title = PAGE_TITLE_ID;
    homeSocialOf(candidate).description = production.ids.protectedDescription;
    assert.equal(compatibilityCode(production, candidate), "ACCEPTED");
  });

  it("refuses the 0.10.0 fixture's re-point, whose editable title is not production's text", () => {
    const production = contentSemanticsFixture();
    assert.equal(compatibilityCode(production, editableSeoFixture()), "COMPATIBILITY_PAGE_SEO_CHANGED");
  });

  type RepointCase = {
    readonly name: string;
    readonly production?: (fixture: Pair) => void;
    readonly candidate: (fixture: Pair) => void;
    readonly code: string;
  };

  const text = (fieldId: string) => (f: Pair) => contentValue(f, fieldId);
  const homeSocial = (f: Pair) => object(metadata(f, f.ids.homePage).social);
  const repointCases: readonly RepointCase[] = [
    { name: "a changed title", candidate: (f) => void (text(EDITABLE_TITLE_ID)(f).value = "home | Gomega"), code: "COMPATIBILITY_PAGE_SEO_CHANGED" },
    { name: "a trailing space", candidate: (f) => void (text(EDITABLE_TITLE_ID)(f).value = "Home | Gomega "), code: "COMPATIBILITY_PAGE_SEO_CHANGED" },
    { name: "a no-break space for a space", candidate: (f) => void (text(EDITABLE_DESCRIPTION_ID)(f).value = "Gomega\u00a0home."), code: "COMPATIBILITY_PAGE_SEO_CHANGED" },
    { name: "a Cyrillic letter that looks Latin", candidate: (f) => void (text(EDITABLE_TITLE_ID)(f).value = "Home | Gomeg\u0430"), code: "COMPATIBILITY_PAGE_SEO_CHANGED" },
    {
      // The contract refuses any string not in NFC before any comparison.
      name: "the decomposed spelling of a composed character",
      production: (f) => void (text(f.ids.protectedDescription)(f).value = "Caf\u00e9 home."),
      candidate: (f) => void (text(EDITABLE_DESCRIPTION_ID)(f).value = "Cafe\u0301 home."),
      code: "JSON_STRING_NOT_NFC",
    },
    {
      name: "a blank value the site would fall back from",
      production: (f) => void (text(f.ids.protectedDescription)(f).value = "  "),
      candidate: () => undefined,
      code: "COMPATIBILITY_PAGE_SEO_CHANGED",
    },
    {
      name: "a new field that is not customer-editable",
      candidate: (f) => {
        const field = renderedField(f, EDITABLE_TITLE_ID);
        field.classification = "code_owned_interface";
        field.capabilities = [];
      },
      code: "CONTRACT_SEO_FIELD_POLICY",
    },
    {
      name: "a new protected field serving the same text",
      candidate: (f) => {
        const original = objects(internalSeo(f).protectedFields).find((field) => field.id === PAGE_TITLE_ID);
        if (original === undefined) throw new Error("Missing page title");
        objects(internalSeo(f).protectedFields).push({ ...structuredClone(original), id: CLONED_TITLE_ID, resolver: { kind: "json_pointer", path: "content/site.json", pointer: "/seo/titleCopy" } });
        objects(f.content.values).push({ ...structuredClone(contentValue(f, PAGE_TITLE_ID)), fieldId: CLONED_TITLE_ID });
        metadata(f, f.ids.homePage).title = CLONED_TITLE_ID;
        const search = objects(objects(f.contract.pages)[0].sections).at(-1);
        if (search !== undefined) search.fields = objects(search.fields).filter((field) => field.id !== EDITABLE_TITLE_ID);
        f.content.values = objects(f.content.values).filter((value) => value.fieldId !== EDITABLE_TITLE_ID);
      },
      code: "COMPATIBILITY_PAGE_SEO_CHANGED",
    },
    {
      name: "a share card that had no title echo, which the site would now fill",
      production: (f) => void (homeSocial(f).title = null),
      candidate: () => undefined,
      code: "COMPATIBILITY_PAGE_SEO_CHANGED",
    },
    {
      name: "a share card that had no description echo",
      production: (f) => void (homeSocial(f).description = null),
      candidate: () => undefined,
      code: "COMPATIBILITY_PAGE_SEO_CHANGED",
    },
    {
      name: "a null share title echo filled with another protected field",
      production: (f) => void (homeSocial(f).title = null),
      candidate: (f) => void (homeSocial(f).title = f.ids.protectedTitle),
      code: "COMPATIBILITY_PAGE_SEO_CHANGED",
    },
    {
      name: "a null share description echo filled with the title's old source",
      production: (f) => void (homeSocial(f).description = null),
      candidate: (f) => void (homeSocial(f).description = PAGE_TITLE_ID),
      code: "CONTRACT_SEO_FIELD_POLICY",
    },
    {
      name: "a share card echo moved to another protected field",
      candidate: (f) => void (homeSocial(f).title = f.ids.protectedTitle),
      code: "COMPATIBILITY_PAGE_SEO_CHANGED",
    },
    {
      name: "the title echo moved to the new field",
      candidate: (f) => void (homeSocial(f).title = EDITABLE_TITLE_ID),
      code: "COMPATIBILITY_PAGE_SEO_CHANGED",
    },
    {
      name: "a site-wide old title, which need not be what the page shows",
      production: (f) => {
        const home = metadata(f, f.ids.homePage);
        home.title = f.ids.protectedTitle;
        homeSocial(f).title = f.ids.protectedTitle;
      },
      candidate: () => undefined,
      code: "COMPATIBILITY_PAGE_SEO_CHANGED",
    },
  ];

  for (const testCase of repointCases) {
    it(`refuses a re-point with ${testCase.name}`, () => {
      const production = productionHome();
      testCase.production?.(production);
      const candidate = adoptEditableHomeSeo(production);
      testCase.candidate(candidate);
      assert.equal(compatibilityCode(production, candidate), testCase.code);
    });
  }

  it("admits a new page with editable SEO while production metadata keeps its protected ids", () => {
    const production = contentSemanticsFixture();
    const candidate = editableSeoFixture();
    const homeFields = new Set([candidate.ids.homeTitle, candidate.ids.homeDescription, candidate.ids.homeImage]);
    seoPage(candidate, candidate.ids.homePage).metadata = structuredClone(
      seoPage(production, production.ids.homePage).metadata,
    );
    objects(objects(candidate.contract.pages)[0].sections).pop();
    candidate.content.values = objects(candidate.content.values).filter(
      (value) => !homeFields.has(value.fieldId as string),
    );
    candidate.content.assetManifest = objects(candidate.content.assetManifest).filter(
      (entry) => entry.path !== socialImageValue("home").path,
    );
    const result = validateManagedSiteContractV1Compatibility(
      parseManagedSiteContractV1(production.contract),
      parseManagedSiteContentDocument(production.content),
      parseManagedSiteContractV1(candidate.contract),
      parseManagedSiteContentDocument(candidate.content),
    );
    for (const id of [candidate.ids.aboutTitle, candidate.ids.aboutDescription, candidate.ids.aboutImage]) {
      assert.ok(result.addedStableIds.includes(id as never));
    }
  });

  it("keeps the protected title and description, and their values, after re-pointing", () => {
    const production = contentSemanticsFixture();
    const dropped = editableSeoFixture();
    internalSeo(dropped).protectedFields = objects(internalSeo(dropped).protectedFields).filter(
      (field) => field.id !== dropped.ids.protectedDescription,
    );
    dropped.content.values = objects(dropped.content.values).filter(
      (value) => value.fieldId !== dropped.ids.protectedDescription,
    );
    assert.equal(compatibilityCode(production, dropped), "COMPATIBILITY_DECLARATION_REMOVED");
    const rewritten = editableSeoFixture();
    contentValue(rewritten, rewritten.ids.protectedDescription).value = "Rewritten while re-pointing.";
    assert.equal(compatibilityCode(production, rewritten), "COMPATIBILITY_CONTENT_CHANGED");
  });

  it("refuses turning a protected field into a rendered SEO field under the same id", () => {
    const production = contentSemanticsFixture();
    const candidate = contentSemanticsFixture();
    const id = candidate.ids.protectedDescriptionField;
    const seo = object(candidate.contract.internalSeo);
    seo.protectedFields = objects(seo.protectedFields).filter((field) => field.id !== id);
    objects(objects(objects(candidate.contract.pages)[0].sections)[0].fields).push(
      seoTextField(id, candidate.ids.homePage, "seo_description", "/seo/description"),
    );
    const value = objects(candidate.content.values).find((entry) => entry.fieldId === id);
    if (value === undefined) throw new Error("Missing protected description value");
    delete value.valueType;
    value.type = "plain_text";
    assert.equal(compatibilityCode(production, candidate), "COMPATIBILITY_FIELD_POLICY_NARROWED");
  });

  it("admits a candidate that widens a title limit up to 320", () => {
    const production = editableSeoFixture();
    const candidate = mutated((f) => { constraints(f, f.ids.homeTitle).maxLength = 320; });
    assert.equal(compatibilityCode(production, candidate), "ACCEPTED");
  });

  const narrowed: readonly Case[] = [
    { name: "a title limit widened past 320", mutate: (f) => { constraints(f, f.ids.homeTitle).maxLength = 321; } },
    { name: "a title limit widened to 320, then a description to 321", mutate: (f) => { constraints(f, f.ids.homeTitle).maxLength = 320; constraints(f, f.ids.homeDescription).maxLength = 321; } },
    { name: "a title that starts allowing newlines", mutate: (f) => { constraints(f, f.ids.homeTitle).newlines = "allow"; } },
    { name: "metadata put back on the protected title, orphaning the editable one", mutate: (f) => { metadata(f, f.ids.homePage).title = f.ids.protectedTitle; } },
  ];
  for (const { name, mutate } of narrowed) {
    it(`refuses a candidate with ${name}`, () => {
      const production = editableSeoFixture();
      assert.equal(compatibilityCode(production, mutated(mutate)), POLICY);
    });
  }
});
