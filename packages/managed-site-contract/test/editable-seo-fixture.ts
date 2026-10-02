import {
  contentSemanticsFixture,
  type ContentSemanticsFixture,
} from "./content-semantics-fixture.js";
import { fixtureId } from "./contract-semantics-fixture.js";

/**
 * The content-semantics fixture with per-page editable SEO: a "Search &
 * sharing" section on the home page holding a `seo_title` and a
 * `seo_description` plain-text field and a share image on a per-site social
 * slot, plus a second static page (`/about`) with the same section, so every
 * "another page's field" case has a real field to point at.
 */

export type JsonObject = Record<string, unknown>;

export interface EditableSeoIds {
  readonly homePage: string;
  readonly aboutPage: string;
  readonly socialAsset: string;
  readonly homeTitle: string;
  readonly homeDescription: string;
  readonly homeImage: string;
  readonly aboutTitle: string;
  readonly aboutDescription: string;
  readonly aboutImage: string;
  readonly bodyField: string;
  readonly protectedTitle: string;
  readonly protectedDescription: string;
  readonly protectedCanonical: string;
  readonly protectedIndexing: string;
}

export interface EditableSeoFixture {
  readonly contract: JsonObject;
  readonly content: JsonObject;
  readonly ids: EditableSeoIds;
}

export function objects(value: unknown): JsonObject[] {
  return value as JsonObject[];
}

export function object(value: unknown): JsonObject {
  return value as JsonObject;
}

export function internalSeo(fixture: { readonly contract: JsonObject }): JsonObject {
  return object(fixture.contract.internalSeo);
}

export function seoPage(fixture: { readonly contract: JsonObject }, pageId: string): JsonObject {
  const page = objects(internalSeo(fixture).pages).find(
    (candidate) => candidate.pageId === pageId,
  );
  if (page === undefined) throw new Error(`Missing SEO page ${pageId}`);
  return page;
}

export function metadata(fixture: { readonly contract: JsonObject }, pageId: string): JsonObject {
  return object(seoPage(fixture, pageId).metadata);
}

export function social(fixture: { readonly contract: JsonObject }, pageId: string): JsonObject {
  return object(metadata(fixture, pageId).social);
}

/** Every rendered field of every page, by id. */
export function renderedField(fixture: { readonly contract: JsonObject }, fieldId: string): JsonObject {
  for (const page of objects(fixture.contract.pages)) {
    for (const section of objects(page.sections)) {
      const field = objects(section.fields).find((candidate) => candidate.id === fieldId);
      if (field !== undefined) return field;
    }
  }
  throw new Error(`Missing rendered field ${fieldId}`);
}

export function contentValue(fixture: { readonly content: JsonObject }, fieldId: string): JsonObject {
  const value = objects(fixture.content.values).find((candidate) => candidate.fieldId === fieldId);
  if (value === undefined) throw new Error(`Missing content value ${fieldId}`);
  return value;
}

function presentation(name: string, order: number): JsonObject {
  return { name, description: null, group: "Search & sharing", order, example: null };
}

function resolver(pointer: string): JsonObject {
  return { kind: "json_pointer", path: "content/site.json", pointer };
}

export function seoTextField(
  id: string,
  pageId: string,
  semantic: "seo_title" | "seo_description",
  pointer: string,
): JsonObject {
  return {
    id,
    scope: "page",
    type: "plain_text",
    classification: "customer_editable",
    capabilities: ["text.edit"],
    resolver: resolver(pointer),
    usages: [{ pageId, itemId: null }],
    presentation: presentation(semantic === "seo_title" ? "Page title" : "Page description", 1),
    semantic,
    constraints: {
      minLength: 0,
      maxLength: semantic === "seo_title" ? 70 : 170,
      newlines: "forbid",
    },
  };
}

export function socialImageField(
  id: string,
  pageId: string,
  assetSlotId: string,
  pointer: string,
): JsonObject {
  return {
    id,
    scope: "page",
    type: "image",
    classification: "customer_editable",
    capabilities: ["image.upload", "image.alt.edit"],
    resolver: resolver(pointer),
    usages: [{ pageId, itemId: null }],
    presentation: presentation("Share image", 3),
    assetSlotId,
  };
}

export function socialImageValue(name: string): JsonObject {
  return {
    path: `public/images/social-${name}.webp`,
    sha256: name === "home" ? "b".repeat(64) : "c".repeat(64),
    mimeType: "image/webp",
    width: 1,
    height: 1,
    bytes: 1,
    altText: `Share image for ${name}`,
    crop: null,
    focalPoint: null,
  };
}

function manifestEntryFor(assetSlotId: string, image: JsonObject): JsonObject {
  return {
    assetSlotId,
    path: image.path,
    sha256: image.sha256,
    mimeType: image.mimeType,
    width: image.width,
    height: image.height,
    bytes: image.bytes,
  };
}

function socialAssetSlot(id: string): JsonObject {
  return {
    id,
    presentation: { name: "Share image", description: null, group: "Search & sharing", order: 1, example: null },
    semantics: { kind: "informative" },
    acceptedMimeTypes: ["image/webp"],
    outputMimeTypes: ["image/webp"],
    minWidth: 1,
    maxWidth: 2,
    minHeight: 1,
    maxHeight: 2,
    aspectRatios: [{ width: 1, height: 1 }],
    cropPolicy: "optional",
    focalPointPolicy: "optional",
    maxBytes: 1,
  };
}

interface PageSeoFields {
  readonly title: string;
  readonly description: string;
  readonly image: string;
}

function searchSection(
  pageId: string,
  name: string,
  fields: PageSeoFields,
  socialAsset: string,
): JsonObject {
  return {
    id: fixtureId("section"),
    presentation: presentation("Search & sharing", 99),
    fields: [
      seoTextField(fields.title, pageId, "seo_title", `/meta/${name}/title`),
      seoTextField(fields.description, pageId, "seo_description", `/meta/${name}/description`),
      socialImageField(fields.image, pageId, socialAsset, `/meta/${name}/image`),
    ],
  };
}

function pageValues(pageId: string, name: string, fields: PageSeoFields): JsonObject[] {
  const owner = { kind: "page", pageId };
  return [
    { fieldId: fields.title, owner, type: "plain_text", value: `${name} | Gomega` },
    { fieldId: fields.description, owner, type: "plain_text", value: `About ${name}.` },
    { fieldId: fields.image, owner, type: "image", value: socialImageValue(name) },
  ];
}

function legacyMetadata(ids: EditableSeoIds): JsonObject {
  return {
    title: ids.protectedTitle,
    description: ids.protectedDescription,
    canonical: ids.protectedCanonical,
    indexing: ids.protectedIndexing,
    social: { title: null, description: null, image: null },
  };
}

function editableMetadata(ids: EditableSeoIds, fields: PageSeoFields): JsonObject {
  return {
    ...legacyMetadata(ids),
    title: fields.title,
    description: fields.description,
    social: { title: null, description: null, image: ids.socialAsset, imageFieldId: fields.image },
  };
}

function protectedIds(base: ContentSemanticsFixture): Pick<
  EditableSeoIds,
  "protectedTitle" | "protectedDescription" | "protectedCanonical" | "protectedIndexing"
> {
  const home = objects(object(base.contract.internalSeo).pages)[0];
  const legacy = object(home.metadata);
  return {
    protectedTitle: legacy.title as string,
    protectedDescription: legacy.description as string,
    protectedCanonical: legacy.canonical as string,
    protectedIndexing: legacy.indexing as string,
  };
}

function addAboutPage(base: ContentSemanticsFixture, ids: EditableSeoIds, about: PageSeoFields): void {
  objects(base.contract.pages).push({
    id: ids.aboutPage,
    presentation: { name: "About", description: null, group: "C3A", order: 50, example: null },
    route: { kind: "static", path: "/about" },
    sections: [searchSection(ids.aboutPage, "about", about, ids.socialAsset)],
  });
  const home = objects(internalSeo(base).pages)[0];
  objects(internalSeo(base).pages).push({
    ...structuredClone(home),
    pageId: ids.aboutPage,
    metadata: editableMetadata(ids, about),
    headingOutline: [],
    jsonLd: [],
    internalLinks: { requiredPageIds: [], minimumInboundLinks: 0 },
    primaryImageAssetSlotId: null,
  });
}

export function editableSeoFixture(): EditableSeoFixture {
  const base = contentSemanticsFixture();
  const home: PageSeoFields = { title: fixtureId("field"), description: fixtureId("field"), image: fixtureId("field") };
  const about: PageSeoFields = { title: fixtureId("field"), description: fixtureId("field"), image: fixtureId("field") };
  const ids: EditableSeoIds = {
    homePage: base.ids.homePage,
    aboutPage: fixtureId("page"),
    socialAsset: fixtureId("asset"),
    homeTitle: home.title,
    homeDescription: home.description,
    homeImage: home.image,
    aboutTitle: about.title,
    aboutDescription: about.description,
    aboutImage: about.image,
    bodyField: base.ids.bodyField,
    ...protectedIds(base),
  };
  objects(base.contract.assets).push(socialAssetSlot(ids.socialAsset));
  objects(objects(base.contract.pages)[0].sections).push(
    searchSection(ids.homePage, "home", home, ids.socialAsset),
  );
  objects(internalSeo(base).pages)[0].metadata = editableMetadata(ids, home);
  addAboutPage(base, ids, about);
  objects(base.content.values).push(
    ...pageValues(ids.homePage, "home", home),
    ...pageValues(ids.aboutPage, "about", about),
  );
  objects(base.content.assetManifest).push(
    manifestEntryFor(ids.socialAsset, socialImageValue("home")),
    manifestEntryFor(ids.socialAsset, socialImageValue("about")),
  );
  return { contract: base.contract, content: base.content, ids };
}

/** Back to the shape every site has today: protected title and description. */
export function legacyMetadataFor(fixture: EditableSeoFixture): JsonObject {
  return legacyMetadata(fixture.ids);
}
