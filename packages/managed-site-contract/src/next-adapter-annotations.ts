import { parseStableId, type StableId } from "./ids.js";

export interface ManagedSitePageAttributesV1 {
  readonly "data-gomega-page-id": StableId<"page">;
}

/**
 * `data-gomega-item-id` is absent for a value the page owns and present for a
 * collection item's copy of one, which is the only thing that tells two of them
 * apart in the rendered page.
 *
 * A collection declares its fields once and renders them once per item, so a
 * field id names a column and an item id names a row. Without the row the markup
 * cannot name the cell, and an editor reading the page can say what was clicked
 * but not which one -- so before this, item values carried no annotation at all
 * rather than an ambiguous one.
 */
export interface ManagedSiteFieldAttributesV1 {
  readonly "data-gomega-field-id": StableId<"field">;
  readonly "data-gomega-item-id"?: StableId<"item">;
}

export function managedSitePageAttributesV1(
  pageId: StableId<"page">,
): ManagedSitePageAttributesV1 {
  return Object.freeze({
    "data-gomega-page-id": parseStableId(pageId, "page"),
  });
}

export function managedSiteFieldAttributesV1(
  fieldId: StableId<"field">,
  itemId?: StableId<"item">,
): ManagedSiteFieldAttributesV1 {
  const fieldAttributes = {
    "data-gomega-field-id": parseStableId(fieldId, "field"),
  };
  return Object.freeze(
    itemId === undefined
      ? fieldAttributes
      : {
          ...fieldAttributes,
          "data-gomega-item-id": parseStableId(itemId, "item"),
        },
  );
}
