import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  parseManagedCollectionDescriptor,
  parseManagedSiteContentDocument,
  validateManagedCollectionValue,
} from "../src/index.js";
import {
  collectionDescriptor,
  contentDocument,
  internalContentValue,
  stableId,
} from "./schema-fixtures.js";

describe("managed content schemas", () => {
  it("requires exact typed owners, values, and asset-manifest entries", () => {
    const document = contentDocument();
    assert.doesNotThrow(() => parseManagedSiteContentDocument(document));
    const values = document.values as Record<string, unknown>[];
    const assetManifest = document.assetManifest as Record<string, unknown>[];
    assert.throws(() =>
      parseManagedSiteContentDocument({
        ...document,
        values: [{ ...values[0], extra: true }],
      }),
    );
    assert.throws(() =>
      parseManagedSiteContentDocument({
        ...document,
        assetManifest: [{ ...assetManifest[0], width: "1600" }],
      }),
    );

    const internalValue = internalContentValue();
    assert.doesNotThrow(() =>
      parseManagedSiteContentDocument({
        schemaVersion: "1.0",
        values: [internalValue],
        assetManifest: [],
      }),
    );
    assert.throws(() =>
      parseManagedSiteContentDocument({
        schemaVersion: "1.0",
        values: [
          {
            ...internalValue,
            valueType: "url",
            value: "https://user@example.com/#secret",
          },
        ],
        assetManifest: [],
      }),
    );
  });

  it("requires bounded server-minted collections without nested collections", () => {
    assert.doesNotThrow(() => parseManagedCollectionDescriptor(collectionDescriptor()));
    assert.throws(() =>
      parseManagedCollectionDescriptor({
        ...collectionDescriptor(),
        itemIdPolicy: "array_index",
      }),
    );
    assert.throws(() =>
      parseManagedCollectionDescriptor({
        ...collectionDescriptor(),
        maxItems: 501,
      }),
    );
    const nested = structuredClone(collectionDescriptor());
    (nested.itemFields as Record<string, unknown>[])[0] = {
      ...(nested.itemFields as Record<string, unknown>[])[0],
      type: "collection",
      collectionId: stableId("collection"),
    };
    assert.throws(() => parseManagedCollectionDescriptor(nested));
  });

  it("enforces collection item bounds and unique server-minted IDs", () => {
    const value = {
      fieldId: stableId("field"),
      owner: { kind: "site" },
      type: "collection",
      value: { orderedItemIds: [stableId("item")] },
    };
    assert.doesNotThrow(() =>
      validateManagedCollectionValue(collectionDescriptor(), value),
    );
    assert.throws(() =>
      validateManagedCollectionValue(collectionDescriptor(), {
        ...value,
        value: { orderedItemIds: [stableId("item"), stableId("item")] },
      }),
    );
    assert.throws(() =>
      validateManagedCollectionValue(
        { ...collectionDescriptor(), minItems: 2 },
        value,
      ),
    );
  });
});
