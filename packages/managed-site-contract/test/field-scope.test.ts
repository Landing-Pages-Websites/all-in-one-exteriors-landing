import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  parseManagedCollectionDescriptor,
  parseManagedFieldDescriptor,
  parseManagedInternalProtectedField,
} from "../src/index.js";
import {
  collectionField,
  collectionDescriptor,
  headingTextField,
  imageField,
  internalProtectedField,
  linkField,
  plainTextField,
  richTextField,
  secondaryPageId,
  stableId,
} from "./schema-fixtures.js";

const OTHER_PAGE_ID = secondaryPageId();
const RENDERED_FIELD_FACTORIES = [
  plainTextField,
  headingTextField,
  richTextField,
  linkField,
  imageField,
  collectionField,
] as const;

function scopedField(scope: "site" | "page"): Record<string, unknown> {
  return { ...plainTextField(), scope };
}

function scopedProtectedField(
  scope: "site" | "page"
): Record<string, unknown> {
  return { ...internalProtectedField(), scope };
}

describe("managed field ownership scope", () => {
  it("requires an exact scope on rendered and protected fields", () => {
    for (const createField of RENDERED_FIELD_FACTORIES) {
      const field = createField();
      delete field.scope;
      assert.throws(() => parseManagedFieldDescriptor(field));
    }

    const protectedField = internalProtectedField();
    delete protectedField.scope;
    assert.throws(() => parseManagedInternalProtectedField(protectedField));

    for (const scope of ["global", "item", null, 1]) {
      assert.throws(() =>
        parseManagedFieldDescriptor({ ...plainTextField(), scope })
      );
      assert.throws(() =>
        parseManagedInternalProtectedField({
          ...internalProtectedField(),
          scope,
        })
      );
    }
  });

  it("accepts site-owned fields across pages", () => {
    const rendered = scopedField("site");
    rendered.usages = [
      { pageId: stableId("page"), itemId: null },
      { pageId: OTHER_PAGE_ID, itemId: null },
    ];
    const protectedField = scopedProtectedField("site");
    protectedField.usages = structuredClone(rendered.usages);

    assert.equal(parseManagedFieldDescriptor(rendered).scope, "site");
    assert.equal(
      parseManagedInternalProtectedField(protectedField).scope,
      "site"
    );
  });

  it("keeps page-owned usages on exactly one page", () => {
    for (const field of [scopedField("page"), scopedProtectedField("page")]) {
      field.usages = [
        { pageId: stableId("page"), itemId: null },
        { pageId: OTHER_PAGE_ID, itemId: null },
      ];
      assert.throws(() =>
        field.type === "internal_protected"
          ? parseManagedInternalProtectedField(field)
          : parseManagedFieldDescriptor(field)
      );
    }

    const repeated = scopedField("page");
    repeated.usages = [
      { pageId: stableId("page"), itemId: null },
      { pageId: stableId("page"), itemId: stableId("item") },
    ];
    assert.equal(parseManagedFieldDescriptor(repeated).scope, "page");
  });

  it("does not add a competing scope to collection item fields", () => {
    const collection = collectionDescriptor();
    const itemFields = collection.itemFields as Record<string, unknown>[];
    itemFields[0].scope = "page";
    assert.throws(() => parseManagedCollectionDescriptor(collection));
  });
});
