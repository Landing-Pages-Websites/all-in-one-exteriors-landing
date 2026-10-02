import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isManagedServedAssetPath,
  MANAGED_SERVED_ASSET_ROOT,
  parseManagedSiteContentDocument,
  parseManagedSiteContentValue,
  validateManagedImageValue,
  validateManagedSiteContentDocumentJsonSchema,
} from "../src/index.js";
import { assetSlot, contentDocument, imageValue, stableId } from "./schema-fixtures.js";

/**
 * 0.12.0: an image value's path, and every asset manifest path, is under
 * public/, the only directory a site serves. Every validator states it the
 * same way -- the zod parsers, the slot policy and the published JSON Schema.
 */

const ACCEPTED = ["public/a.png", "public/images/hero.webp", "public/managed-site-cms/" + "a".repeat(64) + ".webp"];

const REFUSED = [
  "publicx/a.png",
  "./public/a.png",
  "public",
  "public/",
  "Public/a.png",
  "PUBLIC/a.png",
  "public/../src/a.png",
  "/public/a.png",
  "src/public/a.png",
  "src/assets/a.png",
  "a.png",
  "public\\a.png",
];

function imageContentValue(path: string): Record<string, unknown> {
  return {
    fieldId: stableId("field"),
    owner: { kind: "page", pageId: stableId("page") },
    type: "image",
    value: { ...imageValue(), path },
  };
}

function documentWithManifestPath(path: string): Record<string, unknown> {
  const document = contentDocument();
  const [entry] = document.assetManifest as Record<string, unknown>[];
  (entry as Record<string, unknown>).path = path;
  return document;
}

function accepts(check: () => unknown): boolean {
  try {
    check();
    return true;
  } catch {
    return false;
  }
}

describe("served asset paths", () => {
  it("is public/, compared exactly", () => {
    assert.equal(MANAGED_SERVED_ASSET_ROOT, "public/");
  });

  for (const [path, expected] of [
    ...ACCEPTED.map((one) => [one, true] as const),
    ...REFUSED.map((one) => [one, false] as const),
  ]) {
    it(`${expected ? "accepts" : "refuses"} ${JSON.stringify(path)} in every validator`, () => {
      assert.equal(isManagedServedAssetPath(path), expected, "the predicate");
      assert.equal(accepts(() => parseManagedSiteContentValue(imageContentValue(path))), expected, "an image content value");
      assert.equal(accepts(() => validateManagedImageValue(assetSlot(), { ...imageValue(), path })), expected, "the slot policy");
      assert.equal(accepts(() => parseManagedSiteContentDocument(documentWithManifestPath(path))), expected, "a manifest entry");
      assert.equal(
        validateManagedSiteContentDocumentJsonSchema(documentWithManifestPath(path)).valid,
        expected,
        "the published JSON Schema, on a manifest entry",
      );
      const withImage = { ...contentDocument(), values: [imageContentValue(path)] };
      assert.equal(
        validateManagedSiteContentDocumentJsonSchema(withImage).valid,
        expected,
        "the published JSON Schema, on an image value",
      );
    });
  }
});
