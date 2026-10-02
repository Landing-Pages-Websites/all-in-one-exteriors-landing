import {
  conformingContract,
  fixtureId,
} from "./contract-semantics-fixture.js";
import { contentSemanticsFixture } from "./content-semantics-fixture.js";

type JsonObject = Record<string, unknown>;

interface GeneratedSeoIds {
  readonly pageId: string;
  readonly collectionId: string;
  readonly routeKey: string;
  readonly title: string;
  readonly description: string;
  readonly canonical: string;
  readonly indexing: string;
}

interface GeneratedSeoFixture {
  readonly contract: JsonObject;
  readonly content: JsonObject | null;
  readonly ids: GeneratedSeoIds;
}

function object(value: unknown): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Expected fixture object");
  }
  return value as JsonObject;
}

function array(value: unknown): JsonObject[] {
  if (!Array.isArray(value)) throw new Error("Expected fixture array");
  return value as JsonObject[];
}

function presentation(name: string, order: number): JsonObject {
  return {
    name,
    description: null,
    group: "SEO (internal)",
    order,
    example: null,
  };
}

function protectedItemField(
  id: string,
  valueType: string,
  semantic: string,
  pointer: string,
  order: number,
): JsonObject {
  return {
    id,
    type: "internal_protected",
    classification: "internal_protected",
    capabilities: [],
    valueType,
    semantic,
    itemPointer: pointer,
    presentation: presentation(semantic, order),
  };
}

function contentValue(
  ids: GeneratedSeoIds,
  itemId: string,
  fieldId: string,
  valueType: string,
  value: unknown,
): JsonObject {
  return {
    fieldId,
    owner: {
      kind: "collection_item",
      collectionId: ids.collectionId,
      itemId,
    },
    type: "internal_protected",
    valueType,
    value,
  };
}

function generatedDescriptor(
  ids: GeneratedSeoIds,
  headingFieldId: string | null,
  imageFieldId: string | null,
  siteFieldId: string,
): JsonObject {
  return {
    pageId: ids.pageId,
    collectionId: ids.collectionId,
    intent: {
      purpose: "service",
      primaryEntity: ids.title,
      services: [ids.title],
      locations: [],
    },
    metadata: {
      title: ids.title,
      description: ids.description,
      canonical: ids.canonical,
      indexing: ids.indexing,
      social: {
        title: ids.title,
        description: ids.description,
        imageFieldId,
      },
    },
    headingOutline:
      headingFieldId === null
        ? []
        : [{ fieldId: headingFieldId, semanticLevel: 1 }],
    jsonLd: [
      {
        schemaType: "Service",
        required: true,
        itemSourceFieldIds: [ids.title, ids.description],
        siteSourceFieldIds: [siteFieldId],
        requiredOutputProperties: ["name", "description"],
      },
    ],
    breadcrumbParentPageId: null,
    internalLinks: { requiredPageIds: [], minimumInboundLinks: 0 },
    sitemap: { included: true, changeFrequency: "monthly", priority: 0.8 },
    primaryImageFieldId: imageFieldId,
    performanceBudget: {
      maxLcpMilliseconds: 2_500,
      maxCls: 0.1,
      maxInpMilliseconds: 200,
      maxPageBytes: 1_000_000,
    },
  };
}

function installGeneratedSeo(
  contract: JsonObject,
  content: JsonObject | null,
): GeneratedSeoIds {
  const pages = array(contract.pages);
  const generatedPage = pages.find(
    (page) => object(page.route).kind === "generated",
  );
  if (generatedPage === undefined) throw new Error("Missing generated page");
  const route = object(generatedPage.route);
  const collection = array(contract.collections).find(
    (candidate) => candidate.id === route.collectionId,
  );
  if (collection === undefined) throw new Error("Missing route collection");
  const routeKey = String(route.routeKeyFieldId);
  const ids = {
    pageId: String(generatedPage.id),
    collectionId: String(collection.id),
    routeKey,
    title: fixtureId("field"),
    description: fixtureId("field"),
    canonical: fixtureId("field"),
    indexing: fixtureId("field"),
  };
  const itemFields = array(collection.itemFields);
  const routeKeyIndex = itemFields.findIndex((field) => field.id === routeKey);
  if (routeKeyIndex < 0) throw new Error("Missing route-key field");
  itemFields[routeKeyIndex] = protectedItemField(
    routeKey,
    "string",
    "route.slug",
    "/slug",
    1,
  );
  itemFields.push(
    protectedItemField(ids.title, "string", "seo.title", "/seo/title", 2),
    protectedItemField(
      ids.description,
      "string",
      "seo.description",
      "/seo/description",
      3,
    ),
    protectedItemField(ids.canonical, "url", "seo.canonical", "/seo/canonical", 4),
    protectedItemField(
      ids.indexing,
      "indexing_directives",
      "seo.indexing",
      "/seo/indexing",
      5,
    ),
  );
  const seo = object(contract.internalSeo);
  const heading = itemFields.find((field) => field.type === "heading_text");
  const headingId = typeof heading?.id === "string" ? heading.id : null;
  const image = itemFields.find((field) => field.type === "image");
  const imageFieldId = typeof image?.id === "string" ? image.id : null;
  const siteFieldId = String(array(seo.protectedFields)[0]?.id);
  seo.generatedPages = [
    generatedDescriptor(ids, headingId, imageFieldId, siteFieldId),
  ];
  if (content !== null) installGeneratedContent(content, ids);
  return ids;
}

function installGeneratedContent(content: JsonObject, ids: GeneratedSeoIds): void {
  const values = array(content.values);
  const routeKeyValue = values.find((value) => value.fieldId === ids.routeKey);
  if (routeKeyValue === undefined) throw new Error("Missing route-key value");
  routeKeyValue.type = "internal_protected";
  routeKeyValue.valueType = "string";
  const owner = object(routeKeyValue.owner);
  const itemId = String(owner.itemId);
  values.push(
    contentValue(ids, itemId, ids.title, "string", "Service One | Gomega"),
    contentValue(ids, itemId, ids.description, "string", "Service One description"),
    contentValue(ids, itemId, ids.canonical, "url", "https://example.com/services/service-one"),
    contentValue(ids, itemId, ids.indexing, "indexing_directives", {
      index: true,
      follow: true,
      archive: true,
      imageIndex: true,
      maxSnippet: -1,
      maxImagePreview: "large",
      maxVideoPreview: -1,
    }),
  );
}

export function generatedSeoContractFixture(): GeneratedSeoFixture {
  const contract = conformingContract();
  return { contract, content: null, ids: installGeneratedSeo(contract, null) };
}

export function generatedSeoContentFixture(): GeneratedSeoFixture {
  const fixture = contentSemanticsFixture();
  const ids = installGeneratedSeo(fixture.contract, fixture.content);
  return { contract: fixture.contract, content: fixture.content, ids };
}
