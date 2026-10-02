import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ManagedSiteContractError,
  parseManagedCollectionDescriptor,
  parseManagedSiteContentDocument,
  parseManagedSiteContractV1,
  projectManagedSiteContentDocumentV1,
  validateManagedSiteContractV1ContentSemantics,
  type ManagedInternalProtectedCollectionItemField,
} from "../src/index.js";
import {
  protectedItemFixture,
  protectedItemProjectionFixture,
} from "./protected-item-field-fixture.js";
import { fixtureId } from "./contract-semantics-fixture.js";

type JsonObject = Record<string, unknown>;

function expectCode(action: () => unknown, code: string): void {
  assert.throws(action, (error: unknown) => {
    assert.ok(error instanceof ManagedSiteContractError);
    assert.equal(error.code, code);
    return true;
  });
}

function firstCollection(contract: JsonObject): JsonObject {
  const collection = (contract.collections as JsonObject[])[0];
  if (collection === undefined) throw new Error("Missing fixture collection");
  return collection;
}

function protectedValue(content: JsonObject, fieldId: string): JsonObject {
  const value = (content.values as JsonObject[]).find(
    (candidate) => candidate.fieldId === fieldId,
  );
  if (value === undefined) throw new Error("Missing protected item value");
  return value;
}

function compileProtectedItemField(
  field: ManagedInternalProtectedCollectionItemField,
): string {
  return field.valueType;
}
void compileProtectedItemField;

describe("managed-site protected collection-item fields", () => {
  it("parses a strict frozen internal-only item descriptor", () => {
    const fixture = protectedItemFixture();
    const collection = parseManagedCollectionDescriptor(
      firstCollection(fixture.contract),
    );
    const field = collection.itemFields.find(
      (candidate) => candidate.id === fixture.fieldId,
    );

    assert.notEqual(field, undefined);
    assert.equal(field?.type, "internal_protected");
    assert.equal(field?.classification, "internal_protected");
    assert.deepEqual(field?.capabilities, []);
    assert.equal(Object.isFrozen(field), true);
  });

  it("accepts exact protected values in the complete content graph", () => {
    const fixture = protectedItemFixture();
    const contract = parseManagedSiteContractV1(fixture.contract);
    const content = parseManagedSiteContentDocument(fixture.content);

    assert.doesNotThrow(() =>
      validateManagedSiteContractV1ContentSemantics(contract, content),
    );
  });

  it("projects exact value type and collection-item ownership", () => {
    const fixture = protectedItemProjectionFixture();
    const contract = parseManagedSiteContractV1(fixture.contract);
    const content = projectManagedSiteContentDocumentV1(
      contract,
      fixture.sourceDocuments,
    );
    const value = protectedValue(
      content as unknown as JsonObject,
      fixture.fieldId,
    );

    assert.equal(value.type, "internal_protected");
    assert.equal(value.valueType, "string");
    assert.equal(value.value, "Service One | Gomega");
    assert.equal((value.owner as JsonObject).kind, "collection_item");
    assert.equal((value.owner as JsonObject).collectionId, fixture.collectionId);
  });

  it("fails closed for wrong value type and missing protected item values", () => {
    const wrongType = protectedItemFixture();
    const wrongTypeField = (
      firstCollection(wrongType.contract).itemFields as JsonObject[]
    ).find((candidate) => candidate.id === wrongType.fieldId);
    if (wrongTypeField === undefined) {
      throw new Error("Missing protected descriptor");
    }
    wrongTypeField.valueType = "url";
    expectCode(
      () =>
        validateManagedSiteContractV1ContentSemantics(
          parseManagedSiteContractV1(wrongType.contract),
          parseManagedSiteContentDocument(wrongType.content),
        ),
      "CONTENT_VALUE_POLICY",
    );

    const missing = protectedItemFixture();
    missing.content.values = (missing.content.values as JsonObject[]).filter(
      (value) => value.fieldId !== missing.fieldId,
    );
    expectCode(
      () =>
        validateManagedSiteContractV1ContentSemantics(
          parseManagedSiteContractV1(missing.contract),
          parseManagedSiteContentDocument(missing.content),
        ),
      "CONTENT_ITEM_VALUE_MISSING",
    );
  });

  it("rejects cross-collection protected ownership", () => {
    const fixture = protectedItemFixture();
    const value = protectedValue(fixture.content, fixture.fieldId);
    value.owner = {
      kind: "collection_item",
      collectionId: fixtureId("collection"),
      itemId: fixture.itemId,
    };
    expectCode(
      () =>
        validateManagedSiteContractV1ContentSemantics(
          parseManagedSiteContractV1(fixture.contract),
          parseManagedSiteContentDocument(fixture.content),
        ),
      "CONTENT_OWNER_SCOPE",
    );
  });

  it("rejects customer authority and case-folded uniqueness", () => {
    const escalated = protectedItemFixture();
    const collection = firstCollection(escalated.contract);
    const field = (collection.itemFields as JsonObject[]).find(
      (candidate) => candidate.id === escalated.fieldId,
    );
    if (field === undefined) throw new Error("Missing protected descriptor");
    field.classification = "customer_editable";
    field.capabilities = ["text.edit"];
    assert.throws(() => parseManagedSiteContractV1(escalated.contract));

    const uniqueness = protectedItemFixture();
    (firstCollection(uniqueness.contract).uniqueness as JsonObject[]).push({
      fieldIds: [uniqueness.fieldId],
      comparison: "case_folded",
    });
    expectCode(
      () =>
        validateManagedSiteContractV1ContentSemantics(
          parseManagedSiteContractV1(uniqueness.contract),
          parseManagedSiteContentDocument(uniqueness.content),
        ),
      "CONTENT_COLLECTION_UNIQUENESS_POLICY",
    );
  });
});
