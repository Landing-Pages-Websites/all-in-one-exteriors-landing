type StableKind =
  | "contract"
  | "page"
  | "section"
  | "field"
  | "collection"
  | "item"
  | "asset"
  | "alias";

let nextId = 1;

export function resetContractFixtureIds(): void {
  nextId = 1;
}

export function fixtureId(kind: StableKind): string {
  return `${kind}_${String(nextId++).padStart(25, "0")}0`;
}

function presentation(name: string): object {
  return { name, description: null, group: "C3A", order: nextId, example: null };
}

function resolver(pointer: string): object {
  return { kind: "json_pointer", path: "content/site.json", pointer };
}

function protectedItemField(
  id: string,
  valueType: string,
  semantic: string,
  pointer: string,
): object {
  return {
    id,
    type: "internal_protected",
    classification: "internal_protected",
    capabilities: [],
    valueType,
    semantic,
    itemPointer: pointer,
    presentation: presentation(semantic),
  };
}

function pageProtectedField(
  id: string,
  pageId: string,
  valueType: string,
  semantic: string,
  pointer: string,
): object {
  return {
    id,
    scope: "page",
    type: "internal_protected",
    classification: "internal_protected",
    capabilities: [],
    valueType,
    semantic,
    resolver: resolver(pointer),
    usages: [{ pageId, itemId: null }],
    presentation: presentation(semantic),
  };
}

function headingItemField(id: string): object {
  return {
    id,
    type: "heading_text",
    classification: "customer_editable",
    capabilities: ["text.edit"],
    itemPointer: "/heading",
    presentation: presentation("Service heading"),
    semanticLevel: 1,
    constraints: { minLength: 1, maxLength: 80, newlines: "forbid" },
  };
}

function imageItemField(id: string, assetSlotId: string): object {
  return {
    id,
    type: "image",
    classification: "customer_editable",
    capabilities: ["image.upload", "image.alt.edit"],
    itemPointer: "/image",
    presentation: presentation("Service image"),
    assetSlotId,
  };
}

function textField(id: string, pageId: string, pointer: string, type = "plain_text"): object {
  const base = {
    id,
    scope: "page",
    classification: "customer_editable",
    capabilities: ["text.edit"],
    resolver: resolver(pointer),
    usages: [{ pageId, itemId: null }],
    presentation: presentation(pointer),
  };
  if (type === "heading_text") {
    return { ...base, type, semanticLevel: 1, constraints: { minLength: 1, maxLength: 80, newlines: "forbid" } };
  }
  return { ...base, type, semantic: "body", constraints: { minLength: 1, maxLength: 120, newlines: "forbid" } };
}

export function conformingContract(): Record<string, unknown> {
  resetContractFixtureIds();
  const contractId = fixtureId("contract");
  const homeId = fixtureId("page");
  const generatedId = fixtureId("page");
  const sectionId = fixtureId("section");
  const collectionId = fixtureId("collection");
  const assetId = fixtureId("asset");
  const aliasId = fixtureId("alias");
  const titleId = fixtureId("field");
  const bodyId = fixtureId("field");
  const imageId = fixtureId("field");
  const collectionFieldId = fixtureId("field");
  const protectedId = fixtureId("field");
  const routeKeyId = fixtureId("field");
  const generatedTitleId = fixtureId("field");
  const generatedDescriptionId = fixtureId("field");
  const generatedCanonicalId = fixtureId("field");
  const generatedIndexingId = fixtureId("field");
  const generatedHeadingId = fixtureId("field");
  const generatedImageId = fixtureId("field");
  const itemId = fixtureId("item");
  // Minted last so every id above keeps the value it had before these existed.
  const protectedDescriptionId = fixtureId("field");
  const protectedCanonicalId = fixtureId("field");
  const protectedIndexingId = fixtureId("field");
  return {
    schemaVersion: "1.0",
    contractId,
    adapter: { kind: "nextjs", adapterVersion: "1.0" },
    bridge: {
      reviewProtocol: 1,
      editProtocol: 2,
      annotationVersion: 1,
      delivery: { version: "v10", src: "https://app.gomega.ai/review-bridge/v10/review-bridge.js", integrity: `sha384-${"a".repeat(64)}`, crossOrigin: "anonymous", load: "head_defer" },
      framing: "authenticated_preview_gateway",
    },
    pages: [
      {
        id: homeId,
        presentation: presentation("Home"),
        route: { kind: "static", path: "/" },
        sections: [{ id: sectionId, presentation: presentation("Hero"), fields: [
          textField(titleId, homeId, "/hero/title", "heading_text"),
          textField(bodyId, homeId, "/hero/body"),
          { id: imageId, scope: "page", type: "image", classification: "customer_editable", capabilities: ["image.upload"], resolver: resolver("/hero/image"), usages: [{ pageId: homeId, itemId }], presentation: presentation("Image"), assetSlotId: assetId },
          { id: collectionFieldId, scope: "page", type: "collection", classification: "customer_editable", capabilities: ["collection.reorder"], resolver: resolver("/hero/services"), usages: [{ pageId: homeId, itemId: null }], presentation: presentation("Services"), collectionId },
        ] }],
      },
      { id: generatedId, presentation: presentation("Service"), route: { kind: "generated", pattern: "/services/[slug]", collectionId, routeKeyFieldId: routeKeyId }, sections: [] },
    ],
    collections: [{
      id: collectionId,
      presentation: presentation("Services"),
      resolver: resolver("/services"),
      itemIdPointer: "/id",
      itemIdPolicy: "server_minted",
      minItems: 0,
      maxItems: 10,
      itemFields: [
        protectedItemField(routeKeyId, "string", "route.slug", "/slug"),
        protectedItemField(generatedTitleId, "string", "seo.title", "/seo/title"),
        protectedItemField(generatedDescriptionId, "string", "seo.description", "/seo/description"),
        protectedItemField(generatedCanonicalId, "url", "seo.canonical", "/seo/canonical"),
        protectedItemField(generatedIndexingId, "indexing_directives", "seo.indexing", "/seo/indexing"),
        headingItemField(generatedHeadingId),
        imageItemField(generatedImageId, assetId),
      ],
      uniqueness: [{ fieldIds: [routeKeyId], comparison: "exact" }],
      deletion: { whenReferenced: "restrict", restorable: true },
    }],
    assets: [{ id: assetId, presentation: presentation("Hero image"), semantics: { kind: "informative" }, acceptedMimeTypes: ["image/webp"], outputMimeTypes: ["image/webp"], minWidth: 1, maxWidth: 2, minHeight: 1, maxHeight: 2, aspectRatios: [{ width: 1, height: 1 }], cropPolicy: "optional", focalPointPolicy: "optional", maxBytes: 1 }],
    internalSeo: {
      protectedFields: [
        { id: protectedId, scope: "site", type: "internal_protected", classification: "internal_protected", capabilities: [], valueType: "string", semantic: "seo.title", resolver: resolver("/seo/title"), usages: [{ pageId: homeId, itemId: null }], presentation: presentation("SEO title") },
        pageProtectedField(protectedDescriptionId, homeId, "string", "seo.description", "/seo/description"),
        pageProtectedField(protectedCanonicalId, homeId, "url", "seo.canonical", "/seo/canonical"),
        pageProtectedField(protectedIndexingId, homeId, "indexing_directives", "seo.indexing", "/seo/indexing"),
      ],
      businessIdentity: { legalName: protectedId, displayName: protectedId, telephone: protectedId, postalAddress: protectedId, email: null, geo: null, openingHours: null, sameAs: null },
      pages: [{ pageId: homeId, intent: { purpose: "home", primaryEntity: protectedId, services: [], locations: [] }, metadata: { title: protectedId, description: protectedDescriptionId, canonical: protectedCanonicalId, indexing: protectedIndexingId, social: { title: null, description: null, image: assetId } }, headingOutline: [{ fieldId: titleId, semanticLevel: 1 }], jsonLd: [{ schemaType: "LocalBusiness", required: true, sourceFieldIds: [protectedId], requiredOutputProperties: ["name"] }], breadcrumbParentPageId: null, internalLinks: { requiredPageIds: [generatedId], minimumInboundLinks: 0 }, sitemap: { included: true, changeFrequency: "monthly", priority: 1 }, primaryImageAssetSlotId: assetId, performanceBudget: { maxLcpMilliseconds: 1, maxCls: 0, maxInpMilliseconds: 1, maxPageBytes: 1 } }],
      generatedPages: [{
        pageId: generatedId,
        collectionId,
        intent: { purpose: "service", primaryEntity: generatedTitleId, services: [generatedTitleId], locations: [] },
        metadata: { title: generatedTitleId, description: generatedDescriptionId, canonical: generatedCanonicalId, indexing: generatedIndexingId, social: { title: generatedTitleId, description: generatedDescriptionId, imageFieldId: generatedImageId } },
        headingOutline: [{ fieldId: generatedHeadingId, semanticLevel: 1 }],
        jsonLd: [{ schemaType: "Service", required: true, itemSourceFieldIds: [generatedTitleId, generatedDescriptionId], siteSourceFieldIds: [protectedId], requiredOutputProperties: ["name", "description"] }],
        breadcrumbParentPageId: homeId,
        internalLinks: { requiredPageIds: [homeId], minimumInboundLinks: 1 },
        sitemap: { included: true, changeFrequency: "monthly", priority: 0.8 },
        primaryImageFieldId: generatedImageId,
        performanceBudget: { maxLcpMilliseconds: 1, maxCls: 0, maxInpMilliseconds: 1, maxPageBytes: 1 },
      }],
      redirects: [{ fromPath: "/old", destination: { kind: "page", pageId: homeId }, status: 301, preserveQuery: true }],
    },
    atomicAliasGroups: [{ id: aliasId, fieldIds: [titleId, bodyId] }],
    tombstonedIds: [],
  };
}
