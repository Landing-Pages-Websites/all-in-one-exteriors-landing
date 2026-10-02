import {
  createManagedSiteAstroV1,
  managedRichTextLinkAttributesV1,
  ManagedSiteContractError,
  resolveManagedImageAltText,
  type ManagedCollectionDescriptor,
  type ManagedCollectionItemField,
  type ManagedContentOwner,
  type ManagedFieldDescriptor,
  type ManagedGeneratedPageSeoDescriptor,
  type ManagedInternalProtectedField,
  type ManagedPageDescriptor,
  type ManagedRichTextDocument,
  type ManagedRichTextLinkAttributesV1,
  type ManagedRichTextMark,
  type ManagedSiteContentValue,
  type StableId,
} from "@landing-pages-websites/managed-site-contract";

import servicesSource from "../content/collections/services.json";
import contractSource from "../content/managed-site.contract.json";
import homeSource from "../content/pages/home.json";
import siteSource from "../content/site.json";

const HOME_CONTENT_PATH =
  "fixtures/astro-reference/src/content/pages/home.json";
const SERVICES_CONTENT_PATH =
  "fixtures/astro-reference/src/content/collections/services.json";
const SITE_CONTENT_PATH = "fixtures/astro-reference/src/content/site.json";
const HOME_ROUTE = "/";
const SERVICE_ROUTE_PATTERN = "/services/[slug]";

const site = createManagedSiteAstroV1({
  contract: contractSource,
  sourceDocuments: [
    { path: SITE_CONTENT_PATH, value: siteSource },
    { path: HOME_CONTENT_PATH, value: homeSource },
    { path: SERVICES_CONTENT_PATH, value: servicesSource },
  ],
});

type ContentType = ManagedSiteContentValue["type"];
type ContentByType<Type extends ContentType> = Extract<
  ManagedSiteContentValue,
  { readonly type: Type }
>;
type InternalContent = ContentByType<"internal_protected">;
type FixtureRenderedType =
  | "plain_text"
  | "heading_text"
  | "rich_text"
  | "image"
  | "collection";
type FixtureRenderedValue = ContentByType<FixtureRenderedType>["value"];

function fail(code: string, message: string): never {
  throw new ManagedSiteContractError(code, message);
}

function exactlyOne<Value>(
  values: readonly Value[],
  code: string,
  message: string,
): Value {
  return values.length === 1 && values[0] !== undefined
    ? values[0]
    : fail(code, message);
}

function pageByRoute(path: string): ManagedPageDescriptor {
  return exactlyOne(
    site.contract.pages.filter(
      (page) => page.route.kind === "static" && page.route.path === path,
    ),
    "ASTRO_REFERENCE_PAGE",
    `Expected one static page for ${path}`,
  );
}

function generatedPageByPattern(pattern: string): ManagedPageDescriptor {
  return exactlyOne(
    site.contract.pages.filter(
      (page) =>
        page.route.kind === "generated" && page.route.pattern === pattern,
    ),
    "ASTRO_REFERENCE_GENERATED_PAGE",
    `Expected one generated page for ${pattern}`,
  );
}

function fieldByPointer(
  page: ManagedPageDescriptor,
  pointer: string,
): ManagedFieldDescriptor {
  const fields = page.sections.flatMap((section) => section.fields);
  return exactlyOne(
    fields.filter(
      (field) =>
        field.resolver.path === HOME_CONTENT_PATH &&
        field.resolver.pointer === pointer,
    ),
    "ASTRO_REFERENCE_FIELD",
    `Expected one page field for ${pointer}`,
  );
}

function collectionBySource(): ManagedCollectionDescriptor {
  return exactlyOne(
    site.contract.collections.filter(
      (collection) =>
        collection.resolver.path === SERVICES_CONTENT_PATH &&
        collection.resolver.pointer === "",
    ),
    "ASTRO_REFERENCE_COLLECTION",
    "Expected one services collection",
  );
}

function itemFieldByPointer(
  collection: ManagedCollectionDescriptor,
  pointer: string,
): ManagedCollectionItemField {
  return exactlyOne(
    collection.itemFields.filter((field) => field.itemPointer === pointer),
    "ASTRO_REFERENCE_ITEM_FIELD",
    `Expected one item field for ${pointer}`,
  );
}

function protectedFieldByPointer(
  path: string,
  pointer: string,
): ManagedInternalProtectedField {
  return exactlyOne(
    site.contract.internalSeo.protectedFields.filter(
      (field) =>
        field.resolver.path === path && field.resolver.pointer === pointer,
    ),
    "ASTRO_REFERENCE_PROTECTED_FIELD",
    `Expected one protected field for ${path}#${pointer}`,
  );
}

function pageOwner(pageId: StableId<"page">): ManagedContentOwner {
  return { kind: "page", pageId };
}

function itemOwner(
  collectionId: StableId<"collection">,
  itemId: StableId<"item">,
): ManagedContentOwner {
  return { kind: "collection_item", collectionId, itemId };
}

function renderedValue(
  fieldId: StableId<"field">,
  owner: ManagedContentOwner,
  type: "plain_text" | "heading_text",
): string;
function renderedValue(
  fieldId: StableId<"field">,
  owner: ManagedContentOwner,
  type: "rich_text",
): ContentByType<"rich_text">["value"];
function renderedValue(
  fieldId: StableId<"field">,
  owner: ManagedContentOwner,
  type: "image",
): ContentByType<"image">["value"];
function renderedValue(
  fieldId: StableId<"field">,
  owner: ManagedContentOwner,
  type: "collection",
): ContentByType<"collection">["value"];
function renderedValue(
  fieldId: StableId<"field">,
  owner: ManagedContentOwner,
  type: FixtureRenderedType,
): FixtureRenderedValue {
  switch (type) {
    case "plain_text":
      return site.readValue({ fieldId, owner, type: "plain_text" }).value;
    case "heading_text":
      return site.readValue({ fieldId, owner, type: "heading_text" }).value;
    case "rich_text":
      return site.readValue({ fieldId, owner, type: "rich_text" }).value;
    case "image":
      return site.readValue({ fieldId, owner, type: "image" }).value;
    case "collection":
      return site.readValue({ fieldId, owner, type: "collection" }).value;
  }
}

function internalContent(
  fieldId: StableId<"field">,
  owner: ManagedContentOwner,
): InternalContent {
  return site.readValue({ fieldId, owner, type: "internal_protected" });
}

function internalString(
  fieldId: StableId<"field">,
  owner: ManagedContentOwner,
): string {
  const content = internalContent(fieldId, owner);
  return content.valueType === "string"
    ? content.value
    : fail("ASTRO_REFERENCE_INTERNAL_TYPE", "Expected protected string");
}

function internalUrl(
  fieldId: StableId<"field">,
  owner: ManagedContentOwner,
): string {
  const content = internalContent(fieldId, owner);
  return content.valueType === "url"
    ? content.value
    : fail("ASTRO_REFERENCE_INTERNAL_TYPE", "Expected protected URL");
}

function internalAddress(fieldId: StableId<"field">, owner: ManagedContentOwner) {
  const content = internalContent(fieldId, owner);
  return content.valueType === "postal_address"
    ? content.value
    : fail("ASTRO_REFERENCE_INTERNAL_TYPE", "Expected protected address");
}

function internalStringList(
  fieldId: StableId<"field">,
  owner: ManagedContentOwner,
): readonly string[] {
  const content = internalContent(fieldId, owner);
  return content.valueType === "string_list"
    ? content.value
    : fail("ASTRO_REFERENCE_INTERNAL_TYPE", "Expected protected string list");
}

function internalIndexing(fieldId: StableId<"field">, owner: ManagedContentOwner) {
  const content = internalContent(fieldId, owner);
  return content.valueType === "indexing_directives"
    ? content.value
    : fail("ASTRO_REFERENCE_INTERNAL_TYPE", "Expected indexing directives");
}

function publicAssetPath(path: string): string {
  return path.startsWith("public/") && path.length > "public/".length
    ? `/${path.slice("public/".length)}`
    : fail("ASTRO_REFERENCE_ASSET_PATH", "Image is not a public asset");
}

function seoForStaticPage(
  pageId: StableId<"page">,
): (typeof site.contract.internalSeo.pages)[number] {
  return exactlyOne(
    site.contract.internalSeo.pages.filter((page) => page.pageId === pageId),
    "ASTRO_REFERENCE_STATIC_SEO",
    "Expected one static SEO descriptor",
  );
}

function seoForGeneratedPage(
  pageId: StableId<"page">,
): ManagedGeneratedPageSeoDescriptor {
  return exactlyOne(
    site.contract.internalSeo.generatedPages.filter(
      (page) => page.pageId === pageId,
    ),
    "ASTRO_REFERENCE_GENERATED_SEO",
    "Expected one generated SEO descriptor",
  );
}

const homePage = pageByRoute(HOME_ROUTE);
const generatedPage = generatedPageByPattern(SERVICE_ROUTE_PATTERN);
const servicesCollection = collectionBySource();
const homeSeo = seoForStaticPage(homePage.id);
const generatedSeo = seoForGeneratedPage(generatedPage.id);
const homeOwner = pageOwner(homePage.id);
const siteOwner = Object.freeze({ kind: "site" as const });

function homeField(pointer: string): ManagedFieldDescriptor {
  return fieldByPointer(homePage, pointer);
}

function siteField(pointer: string): ManagedInternalProtectedField {
  return protectedFieldByPointer(SITE_CONTENT_PATH, pointer);
}

function homeProtectedField(pointer: string): ManagedInternalProtectedField {
  return protectedFieldByPointer(HOME_CONTENT_PATH, pointer);
}

const identityFields = Object.freeze({
  legalName: siteField("/identity/legalName"),
  displayName: siteField("/identity/displayName"),
  description: siteField("/identity/description"),
  telephone: siteField("/identity/telephone"),
  postalAddress: siteField("/identity/postalAddress"),
  email: siteField("/identity/email"),
  sameAs: siteField("/identity/sameAs"),
});

const identity = Object.freeze({
  legalName: internalString(identityFields.legalName.id, siteOwner),
  displayName: internalString(identityFields.displayName.id, siteOwner),
  description: internalString(identityFields.description.id, siteOwner),
  telephone: internalString(identityFields.telephone.id, siteOwner),
  postalAddress: internalAddress(identityFields.postalAddress.id, siteOwner),
  email: internalString(identityFields.email.id, siteOwner),
  sameAs: internalStringList(identityFields.sameAs.id, siteOwner),
});

const addressJsonLd = Object.freeze({
  "@type": "PostalAddress",
  ...identity.postalAddress,
});

const providerJsonLd = Object.freeze({
  "@type": "LocalBusiness",
  name: identity.displayName,
  legalName: identity.legalName,
  telephone: identity.telephone,
  address: addressJsonLd,
});

function localBusinessJsonLd(canonical: string) {
  return Object.freeze({
    "@context": "https://schema.org",
    ...providerJsonLd,
    description: identity.description,
    email: identity.email,
    url: canonical,
    sameAs: identity.sameAs,
  });
}

function serviceJsonLd(name: string, description: string, canonical: string) {
  return Object.freeze({
    "@context": "https://schema.org",
    "@type": "Service",
    name,
    description,
    url: canonical,
    provider: providerJsonLd,
  });
}

const homeFields = Object.freeze({
  eyebrow: homeField("/hero/eyebrow"),
  title: homeField("/hero/title"),
  description: homeField("/hero/description"),
  image: homeField("/hero/image"),
  servicesHeading: homeField("/services/heading"),
  servicesOrder: homeField("/services/order"),
  contactHeading: homeField("/contact/heading"),
});

const homeSeoFields = Object.freeze({
  title: homeProtectedField("/seo/title"),
  description: homeProtectedField("/seo/description"),
  canonical: homeProtectedField("/seo/canonical"),
  indexing: homeProtectedField("/seo/indexing"),
});

const serviceFields = Object.freeze({
  slug: itemFieldByPointer(servicesCollection, "/slug"),
  title: itemFieldByPointer(servicesCollection, "/seo/title"),
  description: itemFieldByPointer(servicesCollection, "/seo/description"),
  canonical: itemFieldByPointer(servicesCollection, "/seo/canonical"),
  indexing: itemFieldByPointer(servicesCollection, "/seo/indexing"),
  heading: itemFieldByPointer(servicesCollection, "/heading"),
  summary: itemFieldByPointer(servicesCollection, "/summary"),
  body: itemFieldByPointer(servicesCollection, "/body"),
  image: itemFieldByPointer(servicesCollection, "/image"),
});

function assertSeoFieldIdentity(): void {
  const staticFieldsMatch =
    homeSeo.metadata.title === homeSeoFields.title.id &&
    homeSeo.metadata.description === homeSeoFields.description.id &&
    homeSeo.metadata.canonical === homeSeoFields.canonical.id &&
    homeSeo.metadata.indexing === homeSeoFields.indexing.id;
  const generatedFieldsMatch =
    generatedSeo.metadata.title === serviceFields.title.id &&
    generatedSeo.metadata.description === serviceFields.description.id &&
    generatedSeo.metadata.canonical === serviceFields.canonical.id &&
    generatedSeo.metadata.indexing === serviceFields.indexing.id;
  if (!staticFieldsMatch || !generatedFieldsMatch) {
    fail("ASTRO_REFERENCE_SEO_FIELDS", "SEO descriptors conflict with source fields");
  }
}

assertSeoFieldIdentity();

function imageModel(
  field: ManagedFieldDescriptor | ManagedCollectionItemField,
  owner: ManagedContentOwner,
): Readonly<{ fieldId: StableId<"field">; src: string; alt: string }> {
  if (field.type !== "image") {
    return fail("ASTRO_REFERENCE_IMAGE_FIELD", `Field ${field.id} must be an image`);
  }
  const image = renderedValue(field.id, owner, "image");
  const slot = exactlyOne(
    site.contract.assets.filter((asset) => asset.id === field.assetSlotId),
    "ASTRO_REFERENCE_IMAGE_SLOT",
    `Expected one asset slot for ${field.id}`,
  );
  return Object.freeze({
    fieldId: field.id,
    src: publicAssetPath(image.path),
    alt: resolveManagedImageAltText(slot, image),
  });
}

function serviceModel(itemId: StableId<"item">) {
  const owner = itemOwner(servicesCollection.id, itemId);
  const heading = renderedValue(serviceFields.heading.id, owner, "heading_text");
  const summary = renderedValue(serviceFields.summary.id, owner, "plain_text");
  const canonical = internalUrl(serviceFields.canonical.id, owner);
  return Object.freeze({
    pageId: generatedPage.id,
    itemId,
    slug: internalString(serviceFields.slug.id, owner),
    heading: Object.freeze({ fieldId: serviceFields.heading.id, value: heading }),
    summary: Object.freeze({ fieldId: serviceFields.summary.id, value: summary }),
    body: Object.freeze({
      fieldId: serviceFields.body.id,
      value: renderedValue(serviceFields.body.id, owner, "rich_text"),
    }),
    image: imageModel(serviceFields.image, owner),
    seo: Object.freeze({
      title: internalString(serviceFields.title.id, owner),
      description: internalString(serviceFields.description.id, owner),
      canonical,
      indexing: internalIndexing(serviceFields.indexing.id, owner),
    }),
    jsonLd: serviceJsonLd(heading, summary, canonical),
  });
}

const serviceOrder = renderedValue(
  homeFields.servicesOrder.id,
  homeOwner,
  "collection",
).orderedItemIds;
const serviceModels = Object.freeze(serviceOrder.map(serviceModel));
const homeCanonical = internalUrl(homeSeoFields.canonical.id, homeOwner);

export const managedAstroHome = Object.freeze({
  pageId: homePage.id,
  hero: Object.freeze({
    eyebrow: Object.freeze({
      fieldId: homeFields.eyebrow.id,
      value: renderedValue(homeFields.eyebrow.id, homeOwner, "plain_text"),
    }),
    title: Object.freeze({
      fieldId: homeFields.title.id,
      value: renderedValue(homeFields.title.id, homeOwner, "heading_text"),
    }),
    description: Object.freeze({
      fieldId: homeFields.description.id,
      value: renderedValue(homeFields.description.id, homeOwner, "plain_text"),
    }),
    image: imageModel(homeFields.image, homeOwner),
  }),
  services: Object.freeze({
    heading: Object.freeze({
      fieldId: homeFields.servicesHeading.id,
      value: renderedValue(
        homeFields.servicesHeading.id,
        homeOwner,
        "heading_text",
      ),
    }),
    items: serviceModels,
  }),
  contact: Object.freeze({
    heading: Object.freeze({
      fieldId: homeFields.contactHeading.id,
      value: renderedValue(
        homeFields.contactHeading.id,
        homeOwner,
        "heading_text",
      ),
    }),
  }),
  identity,
  seo: Object.freeze({
    title: internalString(homeSeoFields.title.id, homeOwner),
    description: internalString(homeSeoFields.description.id, homeOwner),
    canonical: homeCanonical,
    indexing: internalIndexing(homeSeoFields.indexing.id, homeOwner),
  }),
  jsonLd: localBusinessJsonLd(homeCanonical),
});

export const managedAstroServicePaths = Object.freeze(
  serviceModels.map((service) =>
    Object.freeze({
      params: Object.freeze({ slug: service.slug }),
      props: Object.freeze({ service }),
    }),
  ),
);

export const managedAstroIdentity = identity;
export type ManagedAstroService = (typeof serviceModels)[number];
export type ManagedAstroRichText = ManagedRichTextDocument;

/**
 * A prose link's attributes. An internal link names a page by id, and this site
 * knows its pages' paths from the contract; a page with no static path is
 * refused rather than linked somewhere.
 */
function staticPagePath(pageId: string): string {
  const page = exactlyOne(
    site.contract.pages.filter((candidate) => candidate.id === pageId),
    "ASTRO_REFERENCE_LINK_PAGE",
    `Expected one page for ${pageId}`,
  );
  return page.route.kind === "static"
    ? page.route.path
    : fail("ASTRO_REFERENCE_LINK_PAGE", `Page ${page.id} has no static path`);
}

export function managedAstroLinkAttributes(
  mark: Extract<ManagedRichTextMark, { readonly type: "link" }>,
): ManagedRichTextLinkAttributesV1 {
  return managedRichTextLinkAttributesV1(mark, staticPagePath);
}
