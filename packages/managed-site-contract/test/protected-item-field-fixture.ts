import { contentSemanticsFixture } from "./content-semantics-fixture.js";
import { fixtureId } from "./contract-semantics-fixture.js";
import { sourceProjectionFixture } from "./source-projection-fixture.js";

type JsonObject = Record<string, unknown>;

export interface ProtectedItemFixture {
  readonly contract: JsonObject;
  readonly content: JsonObject;
  readonly collectionId: string;
  readonly fieldId: string;
  readonly itemId: string;
}

function collectionFrom(contract: JsonObject): JsonObject {
  const collections = contract.collections as JsonObject[];
  const collection = collections[0];
  if (collection === undefined) throw new Error("Missing fixture collection");
  return collection;
}

function addProtectedDescriptor(contract: JsonObject, fieldId: string): void {
  const collection = collectionFrom(contract);
  const itemFields = collection.itemFields as JsonObject[];
  itemFields.push({
    id: fieldId,
    type: "internal_protected",
    classification: "internal_protected",
    capabilities: [],
    valueType: "string",
    semantic: "seo.title",
    itemPointer: "/seoTitle",
    presentation: {
      name: "Service metadata title",
      description: null,
      group: "SEO (internal)",
      order: 50,
      example: null,
    },
  });
}

function addProtectedValue(
  content: JsonObject,
  collectionId: string,
  itemId: string,
  fieldId: string,
): void {
  const values = content.values as JsonObject[];
  values.push({
    fieldId,
    owner: { kind: "collection_item", collectionId, itemId },
    type: "internal_protected",
    valueType: "string",
    value: "Service One | Gomega",
  });
}

export function protectedItemFixture(): ProtectedItemFixture {
  const fixture = contentSemanticsFixture();
  const fieldId = fixtureId("field");
  addProtectedDescriptor(fixture.contract, fieldId);
  addProtectedValue(
    fixture.content,
    fixture.ids.collection,
    fixture.ids.item,
    fieldId,
  );
  return {
    contract: fixture.contract,
    content: fixture.content,
    collectionId: fixture.ids.collection,
    fieldId,
    itemId: fixture.ids.item,
  };
}

export function protectedItemProjectionFixture(): {
  readonly contract: JsonObject;
  readonly expectedContent: JsonObject;
  readonly collectionId: string;
  readonly fieldId: string;
  readonly sourceDocuments: Array<{ path: string; value: JsonObject }>;
} {
  const fixture = sourceProjectionFixture();
  const fieldId = fixtureId("field");
  const collectionId = collectionFrom(fixture.contract).id;
  if (typeof collectionId !== "string") {
    throw new Error("Missing projection collection ID");
  }
  addProtectedDescriptor(fixture.contract, fieldId);
  addProtectedValue(
    fixture.expectedContent,
    collectionId,
    fixture.ids.item,
    fieldId,
  );
  const source = fixture.sourceDocuments[0]?.value;
  const item = (source?.services as JsonObject[] | undefined)?.[0];
  if (item === undefined) throw new Error("Missing projection service item");
  item.seoTitle = "Service One | Gomega";
  return {
    contract: fixture.contract,
    expectedContent: fixture.expectedContent,
    collectionId,
    fieldId,
    sourceDocuments: fixture.sourceDocuments,
  };
}
