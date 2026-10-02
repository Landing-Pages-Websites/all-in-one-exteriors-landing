import { conformingContract, fixtureId } from "./contract-semantics-fixture.js";

type JsonObject = Record<string, unknown>;

export interface ContentSemanticsFixtureIds {
  readonly homePage: string;
  readonly generatedPage: string;
  readonly collection: string;
  readonly item: string;
  readonly asset: string;
  readonly titleField: string;
  readonly bodyField: string;
  readonly imageField: string;
  readonly collectionField: string;
  readonly richField: string;
  readonly linkField: string;
  readonly protectedField: string;
  readonly protectedDescriptionField: string;
  readonly protectedCanonicalField: string;
  readonly protectedIndexingField: string;
  readonly routeKeyField: string;
  readonly generatedTitleField: string;
  readonly generatedDescriptionField: string;
  readonly generatedCanonicalField: string;
  readonly generatedIndexingField: string;
  readonly itemHeadingField: string;
  readonly itemRichField: string;
  readonly itemLinkField: string;
  readonly itemImageField: string;
}

export interface ContentSemanticsFixture {
  readonly contract: JsonObject;
  readonly content: JsonObject;
  readonly ids: ContentSemanticsFixtureIds;
}

interface MutableField extends JsonObject {
  id: string;
  type: string;
  usages?: Array<{ pageId: string; itemId: string | null }>;
}

interface MutableCollection extends JsonObject {
  id: string;
  itemFields: MutableField[];
  uniqueness: Array<{ fieldIds: string[]; comparison: "exact" | "case_folded" }>;
}

interface MutableContract extends JsonObject {
  pages: Array<{
    id: string;
    sections: Array<{ fields: MutableField[] }>;
  }>;
  collections: MutableCollection[];
  assets: Array<JsonObject & { id: string }>;
  internalSeo: {
    protectedFields: MutableField[];
    generatedPages: Array<{
      metadata: {
        title: string;
        description: string;
        canonical: string;
        indexing: string;
      };
    }>;
  };
}

function presentation(name: string, order: number): JsonObject {
  return { name, description: null, group: "C3B", order, example: null };
}

function resolver(pointer: string): JsonObject {
  return { kind: "json_pointer", path: "content/site.json", pointer };
}

function linkConstraints(): JsonObject {
  return {
    labelConstraints: { minLength: 1, maxLength: 80, newlines: "forbid" },
    authority: "internal_only",
    allowedSchemes: [],
    allowedExternalHosts: [],
    fragmentPolicy: "forbid",
    allowedFragments: [],
    allowedTargets: ["same_window"],
  };
}

function richConstraints(): JsonObject {
  return {
    maxCharacters: 500,
    maxNodes: 50,
    allowedBlocks: ["paragraph"],
    allowedMarks: ["bold"],
    allowLinks: true,
    allowedExternalHosts: [],
    allowedTargets: ["same_window"],
  };
}

function richValue(pageId: string): JsonObject {
  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "Details",
            marks: [
              { type: "bold" },
              {
                type: "link",
                destination: { kind: "internal", pageId, fragment: null },
                target: "same_window",
              },
            ],
          },
        ],
      },
    ],
  };
}

function owner(kind: "site" | "page", pageId: string): JsonObject {
  return kind === "site" ? { kind } : { kind, pageId };
}

function itemOwner(collectionId: string, itemId: string): JsonObject {
  return { kind: "collection_item", collectionId, itemId };
}

function imageValue(): JsonObject {
  return {
    path: "public/images/managed.webp",
    sha256: "a".repeat(64),
    mimeType: "image/webp",
    width: 1,
    height: 1,
    bytes: 1,
    altText: "Managed image",
    crop: null,
    focalPoint: null,
  };
}

function manifestEntry(assetSlotId: string): JsonObject {
  const image = imageValue();
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

function renderedValue(
  fieldId: string,
  contentOwner: JsonObject,
  type: string,
  value: unknown,
): JsonObject {
  return { fieldId, owner: contentOwner, type, value };
}

const INDEXING = {
  index: true,
  follow: true,
  archive: true,
  imageIndex: true,
  maxSnippet: -1,
  maxImagePreview: "large",
  maxVideoPreview: -1,
};

function protectedPageValue(
  fieldId: string,
  ids: ContentSemanticsFixtureIds,
  valueType: string,
  value: unknown,
): JsonObject {
  return { fieldId, owner: owner("page", ids.homePage), type: "internal_protected", valueType, value };
}

function protectedItemValue(
  fieldId: string,
  ids: ContentSemanticsFixtureIds,
  valueType: string,
  value: unknown,
): JsonObject {
  return {
    fieldId,
    owner: itemOwner(ids.collection, ids.item),
    type: "internal_protected",
    valueType,
    value,
  };
}

function addRenderedFields(
  contract: MutableContract,
  ids: ContentSemanticsFixtureIds,
): void {
  const fields = contract.pages[0].sections[0].fields;
  const imageUsage = fields[2].usages?.[0];
  if (imageUsage === undefined) throw new Error("C3A fixture must expose image usage");
  imageUsage.itemId = null;
  fields.push(
    {
      id: ids.richField,
      scope: "site",
      type: "rich_text",
      classification: "customer_editable",
      capabilities: ["text.edit", "rich_text.mark.bold", "rich_text.link.edit"],
      resolver: resolver("/hero/rich"),
      usages: [
        { pageId: ids.homePage, itemId: null },
        { pageId: ids.generatedPage, itemId: ids.item },
      ],
      presentation: presentation("Rich copy", 20),
      constraints: richConstraints(),
    },
    {
      id: ids.linkField,
      scope: "page",
      type: "link",
      classification: "customer_editable",
      capabilities: ["link.label.edit", "link.destination.edit", "link.target.edit"],
      resolver: resolver("/hero/link"),
      usages: [{ pageId: ids.homePage, itemId: null }],
      presentation: presentation("Link", 21),
      constraints: linkConstraints(),
    },
  );
}

function addItemFields(
  collection: MutableCollection,
  ids: ContentSemanticsFixtureIds,
): void {
  collection.itemFields.push(
    {
      id: ids.itemRichField,
      type: "rich_text",
      classification: "customer_editable",
      capabilities: ["text.edit", "rich_text.mark.bold", "rich_text.link.edit"],
      itemPointer: "/description",
      presentation: presentation("Item description", 31),
      constraints: richConstraints(),
    },
    {
      id: ids.itemLinkField,
      type: "link",
      classification: "customer_editable",
      capabilities: ["link.label.edit", "link.destination.edit", "link.target.edit"],
      itemPointer: "/link",
      presentation: presentation("Item link", 32),
      constraints: linkConstraints(),
    },
  );
  collection.uniqueness.push({
    fieldIds: [ids.itemHeadingField],
    comparison: "case_folded",
  });
}

function fixtureIds(contract: MutableContract): ContentSemanticsFixtureIds {
  const fields = contract.pages[0].sections[0].fields;
  const collection = contract.collections[0];
  const item = fields[2].usages?.[0]?.itemId;
  if (item === null || item === undefined) {
    throw new Error("C3A fixture must expose its deferred item ID");
  }
  const generatedMetadata = contract.internalSeo.generatedPages[0]?.metadata;
  if (generatedMetadata === undefined) {
    throw new Error("C3A fixture must expose generated SEO metadata");
  }
  const itemHeading = collection.itemFields.find(
    (field) => field.type === "heading_text",
  );
  if (itemHeading === undefined) {
    throw new Error("C3A fixture must expose a generated H1 field");
  }
  const itemImage = collection.itemFields.find((field) => field.type === "image");
  if (itemImage === undefined) {
    throw new Error("C3A fixture must expose a generated image field");
  }
  return {
    homePage: contract.pages[0].id,
    generatedPage: contract.pages[1].id,
    collection: collection.id,
    item,
    asset: contract.assets[0].id,
    titleField: fields[0].id,
    bodyField: fields[1].id,
    imageField: fields[2].id,
    collectionField: fields[3].id,
    richField: fixtureId("field"),
    linkField: fixtureId("field"),
    protectedField: contract.internalSeo.protectedFields[0].id,
    protectedDescriptionField: contract.internalSeo.protectedFields[1].id,
    protectedCanonicalField: contract.internalSeo.protectedFields[2].id,
    protectedIndexingField: contract.internalSeo.protectedFields[3].id,
    routeKeyField: collection.itemFields[0].id,
    generatedTitleField: generatedMetadata.title,
    generatedDescriptionField: generatedMetadata.description,
    generatedCanonicalField: generatedMetadata.canonical,
    generatedIndexingField: generatedMetadata.indexing,
    itemHeadingField: itemHeading.id,
    itemRichField: fixtureId("field"),
    itemLinkField: fixtureId("field"),
    itemImageField: itemImage.id,
  };
}

function orderItemValues(
  values: JsonObject[],
  collection: MutableCollection,
): JsonObject[] {
  const isItemValue = (value: JsonObject) =>
    (value.owner as JsonObject).kind === "collection_item";
  const itemValues = values.filter(isItemValue);
  const orderedItemValues = collection.itemFields.map(({ id }) => {
    const matches = itemValues.filter((value) => value.fieldId === id);
    if (matches.length !== 1) throw new Error(`Expected one fixture value for ${id}`);
    return matches[0];
  });
  return [...values.filter((value) => !isItemValue(value)), ...orderedItemValues];
}

function contentValues(
  ids: ContentSemanticsFixtureIds,
  collection: MutableCollection,
): JsonObject[] {
  const values: JsonObject[] = [
    renderedValue(ids.titleField, owner("page", ids.homePage), "heading_text", "Managed heading"),
    renderedValue(ids.bodyField, owner("page", ids.homePage), "plain_text", "Managed body"),
    renderedValue(ids.imageField, owner("page", ids.homePage), "image", imageValue()),
    renderedValue(ids.collectionField, owner("page", ids.homePage), "collection", {
      orderedItemIds: [ids.item],
    }),
    renderedValue(ids.richField, owner("site", ids.homePage), "rich_text", richValue(ids.homePage)),
    renderedValue(ids.linkField, owner("page", ids.homePage), "link", {
      label: "Learn more",
      // A static page: since 0.13.0 an internal destination must have one path.
      destination: { kind: "internal", pageId: ids.homePage, fragment: null },
      target: "same_window",
    }),
    {
      fieldId: ids.protectedField,
      owner: owner("site", ids.homePage),
      type: "internal_protected",
      valueType: "string",
      value: "Gomega",
    },
    protectedPageValue(ids.protectedDescriptionField, ids, "string", "Gomega home."),
    protectedPageValue(ids.protectedCanonicalField, ids, "url", "https://example.com/"),
    protectedPageValue(ids.protectedIndexingField, ids, "indexing_directives", INDEXING),
    protectedItemValue(ids.routeKeyField, ids, "string", "service-one"),
    protectedItemValue(ids.generatedTitleField, ids, "string", "Service One | Gomega"),
    protectedItemValue(
      ids.generatedDescriptionField,
      ids,
      "string",
      "Service One description",
    ),
    protectedItemValue(
      ids.generatedCanonicalField,
      ids,
      "url",
      "https://example.com/services/service-one",
    ),
    protectedItemValue(ids.generatedIndexingField, ids, "indexing_directives", INDEXING),
    renderedValue(ids.itemHeadingField, itemOwner(ids.collection, ids.item), "heading_text", "Service One"),
    renderedValue(ids.itemRichField, itemOwner(ids.collection, ids.item), "rich_text", richValue(ids.homePage)),
    renderedValue(ids.itemLinkField, itemOwner(ids.collection, ids.item), "link", {
      label: "Home",
      destination: { kind: "internal", pageId: ids.homePage, fragment: null },
      target: "same_window",
    }),
    renderedValue(ids.itemImageField, itemOwner(ids.collection, ids.item), "image", imageValue()),
  ];
  return orderItemValues(values, collection);
}

export function contentSemanticsFixture(): ContentSemanticsFixture {
  const contract = conformingContract() as MutableContract;
  const ids = fixtureIds(contract);
  addRenderedFields(contract, ids);
  addItemFields(contract.collections[0], ids);
  return {
    contract,
    content: {
      schemaVersion: "1.0",
      values: contentValues(ids, contract.collections[0]),
      assetManifest: [manifestEntry(ids.asset)],
    },
    ids,
  };
}

function fixtureValues(fixture: ContentSemanticsFixture): JsonObject[] {
  return fixture.content.values as JsonObject[];
}

function fixturePageFields(fixture: ContentSemanticsFixture): MutableField[] {
  return (fixture.contract as MutableContract).pages[0].sections[0].fields;
}

function fixtureCollectionValue(fixture: ContentSemanticsFixture): JsonObject {
  const value = fixtureValues(fixture).find(
    (candidate) => candidate.fieldId === fixture.ids.collectionField,
  );
  if (value === undefined) throw new Error("Missing collection fixture value");
  return value;
}

function fixtureItemValues(
  fixture: ContentSemanticsFixture,
  itemId: string,
): JsonObject[] {
  return fixtureValues(fixture).filter((value) => {
    const contentOwner = value.owner as JsonObject;
    return contentOwner.kind === "collection_item" && contentOwner.itemId === itemId;
  });
}

export function addSecondFixtureItem(
  fixture: ContentSemanticsFixture,
  options: { readonly heading?: string; readonly routeKey?: string } = {},
): string {
  const secondItem = fixtureId("item");
  const collection = fixtureCollectionValue(fixture).value as {
    orderedItemIds: string[];
  };
  collection.orderedItemIds.push(secondItem);
  const copies = fixtureItemValues(fixture, fixture.ids.item).map((value) => {
    const copy = structuredClone(value);
    (copy.owner as JsonObject).itemId = secondItem;
    if (copy.fieldId === fixture.ids.itemHeadingField) {
      copy.value = options.heading ?? "Service Two";
    }
    if (copy.fieldId === fixture.ids.routeKeyField) {
      copy.value = options.routeKey ?? "service-two";
    }
    return copy;
  });
  fixtureValues(fixture).push(...copies);
  return secondItem;
}

function secondCollectionDescriptor(
  collectionId: string,
  itemFieldId: string,
): MutableCollection {
  return {
    id: collectionId,
    presentation: presentation("Other collection", 90),
    resolver: resolver("/other/items"),
    itemIdPointer: "/id",
    itemIdPolicy: "server_minted",
    minItems: 0,
    maxItems: 10,
    itemFields: [{
      id: itemFieldId,
      type: "plain_text",
      classification: "customer_editable",
      capabilities: ["text.edit"],
      itemPointer: "/name",
      presentation: presentation("Other item", 91),
      semantic: "body",
      constraints: { minLength: 1, maxLength: 80, newlines: "forbid" },
    }],
    uniqueness: [],
    deletion: { whenReferenced: "restrict", restorable: true },
  };
}

function secondCollectionField(
  fixture: ContentSemanticsFixture,
  collectionId: string,
  fieldId: string,
): MutableField {
  return {
    id: fieldId,
    scope: "page",
    type: "collection",
    classification: "customer_editable",
    capabilities: ["collection.reorder"],
    resolver: resolver("/other/list"),
    usages: [{ pageId: fixture.ids.homePage, itemId: null }],
    presentation: presentation("Other collection", 92),
    collectionId,
  };
}

export function addSecondFixtureCollectionUsingItem(
  fixture: ContentSemanticsFixture,
  itemId: string,
): void {
  const collectionId = fixtureId("collection");
  const collectionFieldId = fixtureId("field");
  const itemFieldId = fixtureId("field");
  const contract = fixture.contract as MutableContract;
  contract.collections.push(secondCollectionDescriptor(collectionId, itemFieldId));
  fixturePageFields(fixture).push(
    secondCollectionField(fixture, collectionId, collectionFieldId),
  );
  fixtureValues(fixture).push(
    renderedValue(collectionFieldId, owner("page", fixture.ids.homePage), "collection", {
      orderedItemIds: [itemId],
    }),
    renderedValue(itemFieldId, itemOwner(collectionId, itemId), "plain_text", "Other item"),
  );
}
