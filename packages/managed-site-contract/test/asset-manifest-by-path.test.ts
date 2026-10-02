import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  canonicalizeJson,
  ManagedSiteContractError,
  normalizeManagedSiteArtifactsV1,
  parseManagedSiteContentDocument,
  parseManagedSiteContractV1,
  projectManagedSiteContentDocumentV1,
  validateManagedSiteContractV1Compatibility,
  validateManagedSiteContractV1ContentSemantics,
} from "../src/index.js";
import {
  addSecondFixtureItem,
  contentSemanticsFixture,
  type ContentSemanticsFixture,
} from "./content-semantics-fixture.js";
import { fixtureId } from "./contract-semantics-fixture.js";
import { sourceProjectionFixture } from "./source-projection-fixture.js";

type JsonObject = Record<string, unknown>;
type Mutation = (fixture: ContentSemanticsFixture) => void;

const SECOND_PATH = "public/images/second.webp";
const THIRD_PATH = "public/images/third.webp";
const SECOND = Object.freeze({ path: SECOND_PATH, sha256: "b".repeat(64) });
const THIRD = Object.freeze({ path: THIRD_PATH, sha256: "d".repeat(64) });

function objects(value: unknown): JsonObject[] {
  return value as JsonObject[];
}

function object(value: unknown): JsonObject {
  return value as JsonObject;
}

function manifest(fixture: ContentSemanticsFixture): JsonObject[] {
  return objects(fixture.content.assetManifest);
}

function itemImage(fixture: ContentSemanticsFixture, itemId: string): JsonObject {
  const found = objects(fixture.content.values).find((value) => {
    const owner = object(value.owner);
    return value.fieldId === fixture.ids.itemImageField && owner.itemId === itemId;
  });
  if (found === undefined) throw new Error(`Missing item image for ${itemId}`);
  return object(found.value);
}

function entryFor(
  fixture: ContentSemanticsFixture,
  assetSlotId: string,
  material: Partial<JsonObject>,
): JsonObject {
  return { ...structuredClone(manifest(fixture)[0]), assetSlotId, ...material };
}

function itemImageField(contract: JsonObject): JsonObject {
  const [collection] = objects(contract.collections);
  const field = objects(collection.itemFields).find((candidate) => candidate.type === "image");
  if (field === undefined) throw new Error("Fixture collection has no image field");
  return field;
}

/**
 * Moves the collection's item image field onto a slot of its own. The base
 * fixture shares one slot between the hero, the items and page SEO, and page
 * SEO cannot name a slot that holds several images.
 */
function giveItemsOwnSlot(contract: JsonObject): string {
  const assets = objects(contract.assets);
  const slot = { ...structuredClone(assets[0]), id: fixtureId("asset") };
  assets.push(slot);
  itemImageField(contract).assetSlotId = slot.id;
  return slot.id;
}

function itemSlot(fixture: ContentSemanticsFixture): string {
  return itemImageField(fixture.contract).assetSlotId as string;
}

function itemSlotFixture(): ContentSemanticsFixture {
  const fixture = contentSemanticsFixture();
  manifest(fixture).push(entryFor(fixture, giveItemsOwnSlot(fixture.contract), {}));
  return fixture;
}

/** Gives a second collection item its own uploaded image, as the CMS does. */
function secondItemWithImage(
  fixture: ContentSemanticsFixture,
  material: Partial<JsonObject> = SECOND,
): string {
  const itemId = addSecondFixtureItem(fixture);
  Object.assign(itemImage(fixture, itemId), material);
  return itemId;
}

/** Adds a live slot referenced only by SEO social metadata, never by a value. */
function addSeoOnlySlot(fixture: ContentSemanticsFixture): string {
  const assets = objects(fixture.contract.assets);
  const asset = { ...structuredClone(assets[0]), id: fixtureId("asset") };
  assets.push(asset);
  const page = objects(object(fixture.contract.internalSeo).pages)[0];
  object(object(page.metadata).social).image = asset.id;
  return asset.id;
}

function parsed(fixture: ContentSemanticsFixture) {
  return {
    contract: parseManagedSiteContractV1(fixture.contract),
    content: parseManagedSiteContentDocument(fixture.content),
  };
}

function validate(mutate: Mutation): void {
  const fixture = itemSlotFixture();
  mutate(fixture);
  const { contract, content } = parsed(fixture);
  validateManagedSiteContractV1ContentSemantics(contract, content);
}

function isCode(code: string) {
  return (error: unknown) =>
    error instanceof ManagedSiteContractError && error.code === code;
}

describe("asset manifest keyed by material path", () => {
  const accepted: ReadonlyArray<{ name: string; mutate: Mutation }> = [
    {
      name: "two collection items holding different images",
      mutate(fixture) {
        secondItemWithImage(fixture);
        manifest(fixture).push(
          entryFor(fixture, itemSlot(fixture), SECOND),
        );
      },
    },
    {
      name: "two collection items sharing one image under one entry",
      mutate(fixture) {
        addSecondFixtureItem(fixture);
      },
    },
    {
      name: "three items where two share an image and one differs",
      mutate(fixture) {
        secondItemWithImage(fixture);
        addSecondFixtureItem(fixture, { heading: "Service Three", routeKey: "service-three" });
        manifest(fixture).push(
          entryFor(fixture, itemSlot(fixture), SECOND),
        );
      },
    },
    {
      name: "one path under two slots with identical material (legacy shape)",
      mutate(fixture) {
        const seoSlot = addSeoOnlySlot(fixture);
        manifest(fixture).push(entryFor(fixture, seoSlot, {}));
      },
    },
    {
      name: "entries listed out of canonical order",
      mutate(fixture) {
        secondItemWithImage(fixture);
        manifest(fixture).unshift(
          entryFor(fixture, itemSlot(fixture), SECOND),
        );
      },
    },
  ];
  for (const testCase of accepted) {
    it(`accepts ${testCase.name}`, () => {
      assert.doesNotThrow(() => validate(testCase.mutate));
    });
  }

  const refused: ReadonlyArray<{ name: string; code: string; mutate: Mutation }> = [
    {
      name: "one path with different material under two slots",
      code: "CONTENT_ASSET_PATH_CONFLICT",
      mutate(fixture) {
        const seoSlot = addSeoOnlySlot(fixture);
        manifest(fixture).push(entryFor(fixture, seoSlot, { sha256: "c".repeat(64) }));
      },
    },
    {
      name: "one path with different material under one slot",
      code: "CONTENT_ASSET_MANIFEST_DUPLICATE",
      mutate(fixture) {
        manifest(fixture).push(entryFor(fixture, fixture.ids.asset, { sha256: "c".repeat(64) }));
      },
    },
    {
      name: "an exact duplicate entry",
      code: "CONTENT_ASSET_MANIFEST_DUPLICATE",
      mutate(fixture) {
        manifest(fixture).push(structuredClone(manifest(fixture)[0]));
      },
    },
    {
      name: "an item image whose path is manifested under another slot only",
      code: "CONTENT_ASSET_MANIFEST_MISMATCH",
      mutate(fixture) {
        secondItemWithImage(fixture);
        const seoSlot = addSeoOnlySlot(fixture);
        manifest(fixture).push(
          entryFor(fixture, seoSlot, SECOND),
        );
      },
    },
    {
      name: "a second item image with no entry at all",
      code: "CONTENT_ASSET_MANIFEST_MISMATCH",
      mutate(fixture) {
        secondItemWithImage(fixture);
      },
    },
    {
      name: "an item image whose entry has different material at its path",
      code: "CONTENT_ASSET_MANIFEST_MISMATCH",
      mutate(fixture) {
        secondItemWithImage(fixture);
        manifest(fixture).push(
          entryFor(fixture, itemSlot(fixture), { path: SECOND_PATH, sha256: "c".repeat(64) }),
        );
      },
    },
    {
      name: "an entry no value of its slot uses",
      code: "CONTENT_ASSET_MANIFEST_UNUSED",
      mutate(fixture) {
        manifest(fixture).push(
          entryFor(fixture, fixture.ids.asset, THIRD),
        );
      },
    },
    {
      name: "two entries for a slot no value uses",
      code: "CONTENT_ASSET_MANIFEST_DUPLICATE",
      mutate(fixture) {
        const seoSlot = addSeoOnlySlot(fixture);
        manifest(fixture).push(
          entryFor(fixture, seoSlot, SECOND),
          entryFor(fixture, seoSlot, THIRD),
        );
      },
    },
  ];
  for (const seoField of ["social image", "primary image"] as const) {
    function pointSeoAt(fixture: ContentSemanticsFixture, assetSlotId: string): void {
      const page = objects(object(fixture.contract.internalSeo).pages)[0];
      if (seoField === "social image") object(object(page.metadata).social).image = assetSlotId;
      else page.primaryImageAssetSlotId = assetSlotId;
    }
    it(`refuses a page ${seoField} naming an item slot that holds two images`, () => {
      assert.throws(
        () =>
          validate((fixture) => {
            secondItemWithImage(fixture);
            manifest(fixture).push(entryFor(fixture, itemSlot(fixture), SECOND));
            pointSeoAt(fixture, itemSlot(fixture));
          }),
        isCode("CONTENT_SEO_IMAGE_AMBIGUOUS"),
      );
    });
    it(`accepts a page ${seoField} naming an item slot that holds one image`, () => {
      assert.doesNotThrow(() =>
        validate((fixture) => {
          addSecondFixtureItem(fixture);
          pointSeoAt(fixture, itemSlot(fixture));
        }),
      );
    });
  }

  for (const testCase of refused) {
    it(`refuses ${testCase.name}`, () => {
      assert.throws(() => validate(testCase.mutate), isCode(testCase.code));
    });
  }
});

describe("projected asset manifest", () => {
  function projectedWithItems(images: ReadonlyArray<Partial<JsonObject>>) {
    const fixture = sourceProjectionFixture();
    giveItemsOwnSlot(fixture.contract);
    const root = fixture.sourceDocuments[0].value;
    const services = root.services as JsonObject[];
    const template = services[0];
    // The first item keeps its identity because contract usages name it.
    root.services = images.map((material, index) => {
      const item = structuredClone(template);
      if (index > 0) {
        item.id = fixtureId("item");
        item.slug = `service-extra-${index}`;
        item.heading = `Service extra ${index}`;
      }
      Object.assign(object(item.image), material);
      return item;
    });
    const order = object(object(root.hero).services);
    order.orderedItemIds = (root.services as JsonObject[]).map((item) => item.id);
    return projectManagedSiteContentDocumentV1(
      parseManagedSiteContractV1(fixture.contract),
      fixture.sourceDocuments,
    );
  }


  it("records one entry per distinct image of a shared slot, ordered by path", () => {
    const content = projectedWithItems([THIRD, {}, SECOND, THIRD]);
    const [hero] = content.assetManifest;
    assert.deepEqual(
      content.assetManifest.map((entry) => [entry.assetSlotId === hero.assetSlotId, entry.path]),
      [
        [true, "public/images/managed.webp"],
        [false, "public/images/managed.webp"],
        [false, SECOND_PATH],
        [false, THIRD_PATH],
      ],
    );
  });

  it("orders entries independently of item order", () => {
    const forward = projectedWithItems([SECOND, THIRD]);
    const reversed = projectedWithItems([THIRD, SECOND]);
    assert.equal(
      canonicalizeJson(forward.assetManifest),
      canonicalizeJson(reversed.assetManifest),
    );
  });

  it("keeps the single-image-per-slot manifest byte-identical to its legacy form", () => {
    const fixture = sourceProjectionFixture();
    const contract = parseManagedSiteContractV1(fixture.contract);
    const content = projectManagedSiteContentDocumentV1(contract, fixture.sourceDocuments);
    // The legacy projector emitted exactly this document for this fixture: one
    // entry for the one slot, in contract slot order.
    const legacy = parseManagedSiteContentDocument(fixture.expectedContent);
    assert.equal(
      canonicalizeJson(content.assetManifest),
      canonicalizeJson(legacy.assetManifest),
    );
    assert.equal(
      normalizeManagedSiteArtifactsV1(contract, content).content.assetManifestSha256,
      normalizeManagedSiteArtifactsV1(contract, legacy).content.assetManifestSha256,
    );
  });
});

describe("compatibility across path-keyed manifests", () => {
  function compare(production: ContentSemanticsFixture, candidate: ContentSemanticsFixture) {
    const left = parsed(production);
    const right = parsed(candidate);
    return validateManagedSiteContractV1Compatibility(
      left.contract,
      left.content,
      right.contract,
      right.content,
    );
  }

  it("accepts a legacy single-image manifest against itself", () => {
    const production = contentSemanticsFixture();
    const result = compare(production, structuredClone(production));
    assert.equal(result.addedAssetManifestCount, 0);
  });

  it("accepts a multi-image production manifest listed in another order", () => {
    const production = itemSlotFixture();
    secondItemWithImage(production);
    manifest(production).push(
      entryFor(production, itemSlot(production), SECOND),
    );
    const candidate = structuredClone(production);
    manifest(candidate).reverse();
    assert.equal(compare(production, candidate).addedAssetManifestCount, 0);
  });

  it("refuses a candidate that moves an SEO-only slot entry to another path", () => {
    const production = contentSemanticsFixture();
    const seoSlot = addSeoOnlySlot(production);
    manifest(production).push(entryFor(production, seoSlot, {}));
    const candidate = structuredClone(production);
    manifest(candidate)[1] = entryFor(candidate, seoSlot, SECOND);
    assert.throws(() => compare(production, candidate), isCode("COMPATIBILITY_ASSET_CHANGED"));
  });

  it("refuses a candidate that changes an SEO-only slot entry's material", () => {
    const production = contentSemanticsFixture();
    const seoSlot = addSeoOnlySlot(production);
    manifest(production).push(entryFor(production, seoSlot, { path: SECOND_PATH }));
    const candidate = structuredClone(production);
    manifest(candidate)[1] = entryFor(candidate, seoSlot, SECOND);
    assert.throws(() => compare(production, candidate), isCode("COMPATIBILITY_ASSET_CHANGED"));
  });
});
