import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ManagedSiteContractError,
  parseManagedSiteContentDocument,
  parseManagedSiteContractV1,
  validateManagedSiteContractV1ContentSemantics,
} from "../src/index.js";
import type {
  ManagedSiteContentDocument,
  ManagedSiteContractV1,
} from "../src/index.js";
import {
  addSecondFixtureCollectionUsingItem,
  addSecondFixtureItem,
  contentSemanticsFixture,
  type ContentSemanticsFixture,
} from "./content-semantics-fixture.js";
import { fixtureId } from "./contract-semantics-fixture.js";

type JsonObject = Record<string, unknown>;
type MutateFixture = (fixture: ContentSemanticsFixture) => void;
type ParsedFixture = { readonly contract: ManagedSiteContractV1; readonly content: ManagedSiteContentDocument };

function objects(value: unknown): JsonObject[] {
  return value as JsonObject[];
}

function object(value: unknown): JsonObject {
  return value as JsonObject;
}

function values(fixture: ContentSemanticsFixture): JsonObject[] {
  return objects(fixture.content.values);
}

function contractPages(fixture: ContentSemanticsFixture): JsonObject[] {
  return objects(fixture.contract.pages);
}

function contractCollections(fixture: ContentSemanticsFixture): JsonObject[] {
  return objects(fixture.contract.collections);
}

function pageFields(fixture: ContentSemanticsFixture): JsonObject[] {
  const sections = objects(contractPages(fixture)[0].sections);
  return objects(sections[0].fields);
}

function contentValue(fixture: ContentSemanticsFixture, fieldId: string): JsonObject {
  const found = values(fixture).find((value) => value.fieldId === fieldId);
  if (found === undefined) throw new Error(`Missing fixture value for ${fieldId}`);
  return found;
}

function collectionValue(fixture: ContentSemanticsFixture): JsonObject {
  return contentValue(fixture, fixture.ids.collectionField);
}

function parsedFixture(mutate?: MutateFixture): ParsedFixture {
  const fixture = contentSemanticsFixture();
  mutate?.(fixture);
  return {
    contract: parseManagedSiteContractV1(fixture.contract),
    content: parseManagedSiteContentDocument(fixture.content),
  };
}

function validateFixture(mutate?: MutateFixture): void {
  const fixture = parsedFixture(mutate);
  validateManagedSiteContractV1ContentSemantics(fixture.contract, fixture.content);
}

function assertCode(mutate: MutateFixture, code: string): void {
  assert.throws(
    () => validateFixture(mutate),
    (error: unknown) =>
      error instanceof ManagedSiteContractError && error.code === code,
  );
}

function withKind(id: string, kind: "field" | "item"): string {
  return `${kind}_${id.slice(id.indexOf("_") + 1)}`;
}

describe("managed-site content semantics", () => {
  it("accepts one complete all-variant content graph", () => {
    assert.doesNotThrow(() => validateFixture());
  });

  it("runs contract semantics before reading content", () => {
    const fixture = contentSemanticsFixture();
    pageFields(fixture)[1].id = pageFields(fixture)[0].id;
    const contract = parseManagedSiteContractV1(fixture.contract);
    const parsedContent = parseManagedSiteContentDocument(fixture.content);
    const content = new Proxy(parsedContent, {
      get(): never {
        throw new Error("content was read before C3A completed");
      },
    });
    assert.throws(
      () => validateManagedSiteContractV1ContentSemantics(contract, content),
      (error: unknown) =>
        error instanceof ManagedSiteContractError &&
        error.code === "CONTRACT_ID_DUPLICATE",
    );
  });

  for (const testCase of [
    {
      name: "unknown field",
      code: "CONTENT_FIELD_UNRESOLVED",
      mutate: (fixture: ContentSemanticsFixture) => {
        contentValue(fixture, fixture.ids.bodyField).fieldId = fixtureId("field");
      },
    },
    {
      name: "tombstoned field",
      code: "CONTENT_FIELD_TOMBSTONED",
      mutate: (fixture: ContentSemanticsFixture) => {
        const id = fixtureId("field");
        (fixture.contract.tombstonedIds as string[]).push(id);
        contentValue(fixture, fixture.ids.bodyField).fieldId = id;
      },
    },
    {
      name: "cross-kind field entropy",
      code: "CONTENT_ID_CROSS_KIND_COLLISION",
      mutate: (fixture: ContentSemanticsFixture) => {
        contentValue(fixture, fixture.ids.bodyField).fieldId =
          withKind(fixture.ids.homePage, "field");
      },
    },
    {
      name: "duplicate value owner",
      code: "CONTENT_VALUE_DUPLICATE",
      mutate: (fixture: ContentSemanticsFixture) => {
        values(fixture).push(structuredClone(contentValue(fixture, fixture.ids.bodyField)));
      },
    },
    {
      name: "missing required value",
      code: "CONTENT_VALUE_MISSING",
      mutate: (fixture: ContentSemanticsFixture) => {
        fixture.content.values = values(fixture).filter(
          (value) => value.fieldId !== fixture.ids.bodyField,
        );
      },
    },
    {
      name: "site field with page owner",
      code: "CONTENT_OWNER_SCOPE",
      mutate: (fixture: ContentSemanticsFixture) => {
        contentValue(fixture, fixture.ids.richField).owner = {
          kind: "page",
          pageId: fixture.ids.homePage,
        };
      },
    },
    {
      name: "page field with site owner",
      code: "CONTENT_OWNER_SCOPE",
      mutate: (fixture: ContentSemanticsFixture) => {
        contentValue(fixture, fixture.ids.bodyField).owner = { kind: "site" };
      },
    },
    {
      name: "page field with foreign page owner",
      code: "CONTENT_OWNER_SCOPE",
      mutate: (fixture: ContentSemanticsFixture) => {
        contentValue(fixture, fixture.ids.bodyField).owner = {
          kind: "page",
          pageId: fixture.ids.generatedPage,
        };
      },
    },
  ]) {
    it(`rejects ${testCase.name}`, () => assertCode(testCase.mutate, testCase.code));
  }
});

describe("managed collection content semantics", () => {
  for (const testCase of [
    {
      name: "duplicate ordered item",
      code: "CONTENT_COLLECTION_POLICY",
      mutate: (fixture: ContentSemanticsFixture) => {
        object(collectionValue(fixture).value).orderedItemIds = [
          fixture.ids.item,
          fixture.ids.item,
        ];
      },
    },
    {
      name: "orphan item value",
      code: "CONTENT_ITEM_ORPHAN",
      mutate: (fixture: ContentSemanticsFixture) => {
        object(contentValue(fixture, fixture.ids.routeKeyField).owner).itemId =
          fixtureId("item");
      },
    },
    {
      name: "tombstoned active item",
      code: "CONTENT_ITEM_TOMBSTONED",
      mutate: (fixture: ContentSemanticsFixture) => {
        (fixture.contract.tombstonedIds as string[]).push(fixture.ids.item);
      },
    },
    {
      name: "cross-kind active item entropy",
      code: "CONTENT_ID_CROSS_KIND_COLLISION",
      mutate: (fixture: ContentSemanticsFixture) => {
        object(collectionValue(fixture).value).orderedItemIds = [
          withKind(fixture.ids.homePage, "item"),
        ];
      },
    },
    {
      name: "missing item field",
      code: "CONTENT_ITEM_VALUE_MISSING",
      mutate: (fixture: ContentSemanticsFixture) => {
        fixture.content.values = values(fixture).filter(
          (value) => value.fieldId !== fixture.ids.itemHeadingField,
        );
      },
    },
    {
      name: "deferred usage item outside active content",
      code: "CONTENT_USAGE_ITEM_UNRESOLVED",
      mutate: (fixture: ContentSemanticsFixture) => {
        const richField = pageFields(fixture).find(
          (field) => field.id === fixture.ids.richField,
        );
        if (richField === undefined) throw new Error("Missing rich fixture field");
        objects(richField.usages)[1].itemId = fixtureId("item");
      },
    },
    {
      name: "item usage on a static page",
      code: "CONTENT_USAGE_ITEM_SCOPE",
      mutate: (fixture: ContentSemanticsFixture) => {
        const richField = pageFields(fixture).find(
          (field) => field.id === fixture.ids.richField,
        );
        if (richField === undefined) throw new Error("Missing rich fixture field");
        objects(richField.usages)[1].pageId = fixture.ids.homePage;
      },
    },
    {
      name: "collection below its minimum",
      code: "CONTENT_COLLECTION_POLICY",
      mutate: (fixture: ContentSemanticsFixture) => {
        contractCollections(fixture)[0].minItems = 2;
      },
    },
    {
      name: "exact uniqueness collision",
      code: "CONTENT_COLLECTION_UNIQUENESS",
      mutate: (fixture: ContentSemanticsFixture) => {
        addSecondFixtureItem(fixture, { routeKey: "service-one" });
      },
    },
    {
      name: "case-folded uniqueness collision",
      code: "CONTENT_COLLECTION_UNIQUENESS",
      mutate: (fixture: ContentSemanticsFixture) => {
        addSecondFixtureItem(fixture, { heading: "service one" });
      },
    },
    {
      name: "case-folded non-text policy",
      code: "CONTENT_COLLECTION_UNIQUENESS_POLICY",
      mutate: (fixture: ContentSemanticsFixture) => {
        const collection = contractCollections(fixture)[0];
        objects(collection.uniqueness)[1].fieldIds = [fixture.ids.itemImageField];
      },
    },
    {
      name: "same item in two collections",
      code: "CONTENT_ITEM_COLLECTION_CONFLICT",
      mutate: (fixture: ContentSemanticsFixture) => {
        addSecondFixtureCollectionUsingItem(fixture, fixture.ids.item);
      },
    },
  ]) {
    it(`rejects ${testCase.name}`, () => assertCode(testCase.mutate, testCase.code));
  }

  it("rejects conflicting views of one collection order", () => {
    assertCode((fixture) => {
      const fieldId = fixtureId("field");
      pageFields(fixture).push({
        id: fieldId,
        scope: "page",
        type: "collection",
        classification: "customer_editable",
        capabilities: ["collection.reorder"],
        resolver: { kind: "json_pointer", path: "content/site.json", pointer: "/other-view" },
        usages: [{ pageId: fixture.ids.homePage, itemId: null }],
        presentation: { name: "Other view", description: null, group: "C3B", order: 99, example: null },
        collectionId: fixture.ids.collection,
      });
      values(fixture).push({
        fieldId,
        owner: { kind: "page", pageId: fixture.ids.homePage },
        type: "collection",
        value: { orderedItemIds: [fixtureId("item")] },
      });
    }, "CONTENT_COLLECTION_ORDER_CONFLICT");
  });
});

describe("managed value and asset semantics", () => {
  for (const testCase of [
    {
      name: "field value type mismatch",
      code: "CONTENT_VALUE_POLICY",
      mutate: (fixture: ContentSemanticsFixture) => {
        contentValue(fixture, fixture.ids.titleField).type = "plain_text";
      },
    },
    {
      name: "field-local constraint failure",
      code: "CONTENT_VALUE_POLICY",
      mutate: (fixture: ContentSemanticsFixture) => {
        contentValue(fixture, fixture.ids.bodyField).value = "";
      },
    },
    {
      name: "protected value type mismatch",
      code: "CONTENT_VALUE_POLICY",
      mutate: (fixture: ContentSemanticsFixture) => {
        const value = contentValue(fixture, fixture.ids.protectedField);
        value.valueType = "number";
        value.value = 1;
      },
    },
    {
      name: "unresolved managed link page",
      code: "CONTENT_LINK_PAGE_UNRESOLVED",
      mutate: (fixture: ContentSemanticsFixture) => {
        const link = object(contentValue(fixture, fixture.ids.linkField).value);
        object(link.destination).pageId = fixtureId("page");
      },
    },
    {
      name: "link field to a generated page, which has no single path",
      code: "CONTENT_LINK_PAGE_UNPATHED",
      mutate: (fixture: ContentSemanticsFixture) => {
        const link = object(contentValue(fixture, fixture.ids.linkField).value);
        object(link.destination).pageId = fixture.ids.generatedPage;
      },
    },
    {
      name: "rich-text link to a generated page, which has no single path",
      code: "CONTENT_RICH_TEXT_LINK_PAGE_UNPATHED",
      mutate: (fixture: ContentSemanticsFixture) => {
        const rich = object(contentValue(fixture, fixture.ids.richField).value);
        const paragraph = objects(rich.content)[0];
        const marks = objects(objects(paragraph.content)[0].marks);
        const link = marks.find((mark) => mark.type === "link");
        if (link === undefined) throw new Error("fixture lost its link mark");
        object(link.destination).pageId = fixture.ids.generatedPage;
      },
    },
    {
      name: "unresolved rich-text link page",
      code: "CONTENT_LINK_PAGE_UNRESOLVED",
      mutate: (fixture: ContentSemanticsFixture) => {
        const rich = object(contentValue(fixture, fixture.ids.richField).value);
        const paragraph = objects(rich.content)[0];
        // The link is one mark among several on the text it covers, so it is
        // found by kind rather than by position.
        const marks = objects(objects(paragraph.content)[0].marks);
        const link = marks.find((mark) => mark.type === "link");
        if (link === undefined) throw new Error("fixture lost its link mark");
        object(link.destination).pageId = fixtureId("page");
      },
    },
    {
      name: "missing image manifest",
      code: "CONTENT_ASSET_MANIFEST_MISSING",
      mutate: (fixture: ContentSemanticsFixture) => {
        fixture.content.assetManifest = [];
      },
    },
    {
      name: "duplicate manifest slot",
      code: "CONTENT_ASSET_MANIFEST_DUPLICATE",
      mutate: (fixture: ContentSemanticsFixture) => {
        const manifest = objects(fixture.content.assetManifest);
        manifest.push(structuredClone(manifest[0]));
      },
    },
    {
      name: "unknown manifest slot",
      code: "CONTENT_ASSET_SLOT_UNRESOLVED",
      mutate: (fixture: ContentSemanticsFixture) => {
        objects(fixture.content.assetManifest)[0].assetSlotId = fixtureId("asset");
      },
    },
    {
      name: "unreferenced manifest slot",
      code: "CONTENT_ASSET_MANIFEST_UNUSED",
      mutate: (fixture: ContentSemanticsFixture) => {
        const asset = structuredClone(objects(fixture.contract.assets)[0]);
        asset.id = fixtureId("asset");
        objects(fixture.contract.assets).push(asset);
        const manifest = structuredClone(objects(fixture.content.assetManifest)[0]);
        manifest.assetSlotId = asset.id;
        objects(fixture.content.assetManifest).push(manifest);
      },
    },
    {
      name: "image alt policy failure",
      code: "CONTENT_ASSET_POLICY",
      mutate: (fixture: ContentSemanticsFixture) => {
        object(contentValue(fixture, fixture.ids.imageField).value).altText = "";
      },
    },
    {
      name: "manifest material policy failure",
      code: "CONTENT_ASSET_POLICY",
      mutate: (fixture: ContentSemanticsFixture) => {
        objects(fixture.content.assetManifest)[0].width = 3;
      },
    },
  ]) {
    it(`rejects ${testCase.name}`, () => assertCode(testCase.mutate, testCase.code));
  }

  for (const property of ["path", "sha256", "mimeType", "width", "height", "bytes"] as const) {
    it(`requires exact image-to-manifest ${property}`, () => {
      assertCode((fixture) => {
        const manifest = objects(fixture.content.assetManifest)[0];
        const slot = objects(fixture.contract.assets)[0];
        if (property === "path") manifest.path = "public/images/other.webp";
        if (property === "sha256") manifest.sha256 = "b".repeat(64);
        if (property === "mimeType") {
          manifest.mimeType = "image/avif";
          slot.outputMimeTypes = ["image/webp", "image/avif"];
        }
        if (property === "width" || property === "height") {
          manifest[property] = 2;
          slot.aspectRatios = [
            { width: 1, height: 1 },
            property === "width" ? { width: 2, height: 1 } : { width: 1, height: 2 },
          ];
        }
        if (property === "bytes") {
          manifest.bytes = 2;
          slot.maxBytes = 2;
        }
      }, "CONTENT_ASSET_MANIFEST_MISMATCH");
    });
  }

  it("allows a referenced SEO-only manifest slot without an image value", () => {
    assert.doesNotThrow(() => validateFixture((fixture) => {
      const asset = structuredClone(objects(fixture.contract.assets)[0]);
      asset.id = fixtureId("asset");
      objects(fixture.contract.assets).push(asset);
      const seo = object(fixture.contract.internalSeo);
      const seoPage = objects(seo.pages)[0];
      object(object(seoPage.metadata).social).image = asset.id;
      const manifest = structuredClone(objects(fixture.content.assetManifest)[0]);
      manifest.assetSlotId = asset.id;
      objects(fixture.content.assetManifest).push(manifest);
    }));
  });
});
