import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ManagedSiteContractError,
  parseManagedSiteContentDocument,
  parseManagedSiteContractV1,
  projectManagedSiteContentDocumentV1,
  validateManagedSiteContractV1ContentSemantics,
} from "../src/index.js";
import { fixtureId } from "./contract-semantics-fixture.js";
import {
  sourceProjectionFixture,
  type SourceProjectionFixture,
} from "./source-projection-fixture.js";

type JsonObject = Record<string, unknown>;

function sourceRoot(fixture: SourceProjectionFixture): JsonObject {
  return fixture.sourceDocuments[0].value;
}

function hero(fixture: SourceProjectionFixture): JsonObject {
  return sourceRoot(fixture).hero as JsonObject;
}

function services(fixture: SourceProjectionFixture): JsonObject[] {
  return sourceRoot(fixture).services as JsonObject[];
}

function field(fixture: SourceProjectionFixture, fieldId: string): JsonObject {
  const pages = fixture.contract.pages as JsonObject[];
  const fields = pages.flatMap((page) =>
    (page.sections as JsonObject[]).flatMap(
      (section) => section.fields as JsonObject[],
    ),
  );
  const match = fields.find((candidate) => candidate.id === fieldId);
  if (match === undefined) throw new Error(`Missing fixture field ${fieldId}`);
  return match;
}

function itemField(fixture: SourceProjectionFixture, fieldId: string): JsonObject {
  const [collection] = fixture.contract.collections as JsonObject[];
  const match = (collection.itemFields as JsonObject[]).find(
    (candidate) => candidate.id === fieldId,
  );
  if (match === undefined) throw new Error(`Missing fixture item field ${fieldId}`);
  return match;
}

function expectCode(action: () => unknown, code: string): void {
  assert.throws(action, (error: unknown) => {
    assert.ok(error instanceof ManagedSiteContractError);
    assert.equal(error.code, code);
    return true;
  });
}

function project(fixture: SourceProjectionFixture) {
  return projectManagedSiteContentDocumentV1(
    parseManagedSiteContractV1(fixture.contract),
    fixture.sourceDocuments,
  );
}

function assertDeepFrozen(value: unknown, seen = new Set<object>()): void {
  if (value === null || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeepFrozen(child, seen);
}

describe("managed-site source projection", () => {
  it("projects the complete all-variant source graph deterministically", () => {
    const fixture = sourceProjectionFixture();
    const contract = parseManagedSiteContractV1(fixture.contract);
    const projected = projectManagedSiteContentDocumentV1(
      contract,
      fixture.sourceDocuments,
    );
    const expected = parseManagedSiteContentDocument(fixture.expectedContent);

    assert.deepEqual(projected, expected);
    validateManagedSiteContractV1ContentSemantics(contract, projected);
    assertDeepFrozen(projected);
  });

  it("resolves escaped object tokens and canonical array indexes", () => {
    const fixture = sourceProjectionFixture();
    const title = hero(fixture).title;
    delete hero(fixture).title;
    sourceRoot(fixture).encoded = { "a/b": { "~key": [title] } };
    (field(fixture, fixture.ids.titleField).resolver as JsonObject).pointer =
      "/encoded/a~1b/~0key/0";

    assert.deepEqual(project(fixture), parseManagedSiteContentDocument(fixture.expectedContent));
  });

  it("projects exact shared pointers only through the declared atomic alias", () => {
    const fixture = sourceProjectionFixture();
    const titleResolver = field(fixture, fixture.ids.titleField).resolver;
    field(fixture, fixture.ids.bodyField).resolver = structuredClone(titleResolver);
    delete hero(fixture).body;

    const projected = project(fixture);
    const aliased = projected.values.filter((value) =>
      [fixture.ids.titleField, fixture.ids.bodyField].includes(value.fieldId),
    );
    assert.deepEqual(aliased.map(({ value }) => value), ["Managed heading", "Managed heading"]);
  });

  for (const testCase of [
    {
      name: "missing source document",
      mutate(fixture: SourceProjectionFixture) {
        fixture.sourceDocuments.splice(0);
      },
      code: "SOURCE_DOCUMENT_MISSING",
    },
    {
      name: "duplicate source document",
      mutate(fixture: SourceProjectionFixture) {
        fixture.sourceDocuments.push(structuredClone(fixture.sourceDocuments[0]));
      },
      code: "SOURCE_PATH_ALIAS",
    },
    {
      name: "case-aliased source document",
      mutate(fixture: SourceProjectionFixture) {
        fixture.sourceDocuments.push({
          path: "content/Site.json",
          value: structuredClone(sourceRoot(fixture)),
        });
      },
      code: "SOURCE_PATH_ALIAS",
    },
    {
      name: "unused source document",
      mutate(fixture: SourceProjectionFixture) {
        fixture.sourceDocuments.push({ path: "content/unused.json", value: {} });
      },
      code: "SOURCE_DOCUMENT_UNUSED",
    },
    {
      name: "unclassified primitive",
      mutate(fixture: SourceProjectionFixture) {
        sourceRoot(fixture).hidden = "unclassified";
      },
      code: "SOURCE_VALUE_UNCLASSIFIED",
    },
    {
      name: "unclassified empty subtree",
      mutate(fixture: SourceProjectionFixture) {
        sourceRoot(fixture).hidden = { empty: [] };
      },
      code: "SOURCE_VALUE_UNCLASSIFIED",
    },
    {
      name: "unclassified array element",
      mutate(fixture: SourceProjectionFixture) {
        sourceRoot(fixture).hidden = ["unclassified"];
      },
      code: "SOURCE_VALUE_UNCLASSIFIED",
    },
  ]) {
    it(`rejects ${testCase.name}`, () => {
      const fixture = sourceProjectionFixture();
      testCase.mutate(fixture);
      expectCode(() => project(fixture), testCase.code);
    });
  }

  it("rejects a scalar before the end of a source pointer", () => {
    const fixture = sourceProjectionFixture();
    (field(fixture, fixture.ids.titleField).resolver as JsonObject).pointer =
      "/hero/title/nested";

    expectCode(() => project(fixture), "SOURCE_POINTER_UNRESOLVED");
  });

  for (const testCase of [
    { name: "a missing object key", pointer: "/hero/missing" },
    { name: "a noncanonical array index", pointer: "/indexed/01" },
    { name: "an out-of-range array index", pointer: "/indexed/1" },
    { name: "the JSON Pointer append token", pointer: "/indexed/-" },
  ]) {
    it(`rejects ${testCase.name}`, () => {
      const fixture = sourceProjectionFixture();
      delete hero(fixture).title;
      sourceRoot(fixture).indexed = ["Managed heading"];
      (field(fixture, fixture.ids.titleField).resolver as JsonObject).pointer =
        testCase.pointer;

      expectCode(() => project(fixture), "SOURCE_POINTER_UNRESOLVED");
    });
  }

  it("rejects accessors before invoking them", () => {
    const fixture = sourceProjectionFixture();
    let calls = 0;
    Object.defineProperty(sourceRoot(fixture), "hidden", {
      enumerable: true,
      get() {
        calls += 1;
        return "private";
      },
    });

    expectCode(() => project(fixture), "JSON_ACCESSOR");
    assert.equal(calls, 0);
  });

  for (const testCase of [
    {
      name: "a non-array collection",
      mutate(fixture: SourceProjectionFixture) {
        sourceRoot(fixture).services = {};
      },
      code: "SOURCE_COLLECTION_NOT_ARRAY",
    },
    {
      name: "a non-object collection item",
      mutate(fixture: SourceProjectionFixture) {
        sourceRoot(fixture).services = ["invalid"];
      },
      code: "SOURCE_COLLECTION_ITEM_INVALID",
    },
    {
      name: "a missing item identity",
      mutate(fixture: SourceProjectionFixture) {
        delete services(fixture)[0].id;
      },
      code: "SOURCE_POINTER_UNRESOLVED",
    },
    {
      name: "an invalid item identity",
      mutate(fixture: SourceProjectionFixture) {
        services(fixture)[0].id = "not-an-item-id";
      },
      code: "SOURCE_COLLECTION_ITEM_ID",
    },
    {
      name: "an unclassified item property",
      mutate(fixture: SourceProjectionFixture) {
        services(fixture)[0].hidden = "unclassified";
      },
      code: "SOURCE_VALUE_UNCLASSIFIED",
    },
  ]) {
    it(`rejects ${testCase.name}`, () => {
      const fixture = sourceProjectionFixture();
      testCase.mutate(fixture);
      expectCode(() => project(fixture), testCase.code);
    });
  }

  it("projects a different image at a different path under one shared slot", () => {
    const fixture = sourceProjectionFixture();
    const itemImage = services(fixture)[0].image as JsonObject;
    itemImage.path = "public/images/conflict.webp";
    itemImage.sha256 = "b".repeat(64);
    // Page SEO names this slot too, and cannot pick one of its two images.
    expectCode(() => project(fixture), "CONTENT_SEO_IMAGE_AMBIGUOUS");
    const seoPage = ((fixture.contract.internalSeo as JsonObject).pages as JsonObject[])[0];
    ((seoPage.metadata as JsonObject).social as JsonObject).image = null;
    seoPage.primaryImageAssetSlotId = null;

    assert.deepEqual(
      project(fixture).assetManifest.map((entry) => entry.path),
      ["public/images/conflict.webp", "public/images/managed.webp"],
    );
  });

  it("rejects conflicting image material at one path sharing one slot", () => {
    const fixture = sourceProjectionFixture();
    const itemImage = services(fixture)[0].image as JsonObject;
    itemImage.sha256 = "b".repeat(64);

    expectCode(() => project(fixture), "CONTENT_ASSET_MANIFEST_MISMATCH");
  });

  describe("collection pointer ownership", () => {
    it("rejects an item field sharing the item identity pointer", () => {
      const fixture = sourceProjectionFixture();
      const [collection] = fixture.contract.collections as JsonObject[];
      collection.itemIdPointer = "/slug";

      expectCode(() => project(fixture), "SOURCE_COLLECTION_POINTER_OVERLAP");
    });

    it("rejects two unaliased item fields sharing an exact pointer", () => {
      const fixture = sourceProjectionFixture();
      itemField(fixture, fixture.ids.itemHeadingField).itemPointer = "/slug";

      expectCode(() => project(fixture), "SOURCE_COLLECTION_POINTER_OVERLAP");
    });

    it("rejects ancestor item-field pointers", () => {
      const fixture = sourceProjectionFixture();
      itemField(fixture, fixture.ids.itemHeadingField).itemPointer = "/nested";
      itemField(fixture, fixture.ids.itemRichField).itemPointer = "/nested/rich";

      expectCode(() => project(fixture), "SOURCE_COLLECTION_POINTER_OVERLAP");
    });
  });

  it("orders derived manifest entries by contract asset declaration", () => {
    const fixture = sourceProjectionFixture();
    const assets = fixture.contract.assets as JsonObject[];
    const secondAsset = structuredClone(assets[0]);
    secondAsset.id = fixtureId("asset");
    assets.unshift(secondAsset);
    itemField(fixture, fixture.ids.itemImageField).assetSlotId = secondAsset.id;
    const itemImage = services(fixture)[0].image as JsonObject;
    itemImage.path = "public/images/second.webp";
    itemImage.sha256 = "b".repeat(64);

    const projected = project(fixture);
    assert.deepEqual(
      projected.assetManifest.map(({ assetSlotId }) => assetSlotId),
      [secondAsset.id, fixture.ids.asset],
    );
  });

  it("fails contract semantics before traversing hostile source values", () => {
    const fixture = sourceProjectionFixture();
    const pages = fixture.contract.pages as JsonObject[];
    pages[1].id = pages[0].id;
    const contract = parseManagedSiteContractV1(fixture.contract);
    let calls = 0;
    Object.defineProperty(sourceRoot(fixture), "hidden", {
      enumerable: true,
      get() {
        calls += 1;
        return "private";
      },
    });

    expectCode(
      () => projectManagedSiteContentDocumentV1(contract, fixture.sourceDocuments),
      "CONTRACT_ID_DUPLICATE",
    );
    assert.equal(calls, 0);
  });
});
