import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  parseManagedCollectionDescriptor,
  parseManagedFieldDescriptor,
  parseManagedRichTextDocument,
  parseManagedSiteContentValue,
  parseManagedSiteContractV1,
  parseManagedSiteSeoDescriptor,
  validateManagedImageValue,
} from "../src/index.js";
import {
  assetSlot,
  collectionDescriptor,
  collectionField,
  headingTextField,
  imageField,
  imageValue,
  linkField,
  managedSiteContract,
  plainTextField,
  richTextDocument,
  richTextField,
  seoDescriptor,
  stableId,
} from "./schema-fixtures.js";

interface ExactKeyCase {
  readonly name: string;
  readonly parse: () => unknown;
}

function extra<Value extends object>(value: Value): Value & { unexpected: boolean } {
  return { ...value, unexpected: true };
}

function contentValue(type: string, value: unknown): Record<string, unknown> {
  return { fieldId: stableId("field"), owner: { kind: "site" }, type, value };
}

function internalValue(valueType: string, value: unknown): Record<string, unknown> {
  return { ...contentValue("internal_protected", value), valueType };
}

function itemField(field: Record<string, unknown>): Record<string, unknown> {
  const item = structuredClone(field);
  delete item.resolver;
  delete item.usages;
  item.itemPointer = "/value";
  return item;
}

function exactRenderedFields(): readonly ExactKeyCase[] {
  const fields = [
    plainTextField(),
    headingTextField(),
    richTextField(),
    linkField(),
    imageField(),
    collectionField(),
  ];
  return fields.map((field) => ({
    name: `field:${String(field.type)}`,
    parse: () => parseManagedFieldDescriptor(extra(field)),
  }));
}

function exactItemFields(): readonly ExactKeyCase[] {
  const fields = [plainTextField(), headingTextField(), richTextField(), linkField(), imageField()];
  return fields.map((field) => ({
    name: `item-field:${String(field.type)}`,
    parse: () => {
      const descriptor = collectionDescriptor();
      descriptor.itemFields = [extra(itemField(field))];
      return parseManagedCollectionDescriptor(descriptor);
    },
  }));
}

function exactOwners(): readonly ExactKeyCase[] {
  const owners = [
    { kind: "site" },
    { kind: "page", pageId: stableId("page") },
    { kind: "collection_item", collectionId: stableId("collection"), itemId: stableId("item") },
  ];
  return owners.map((owner) => ({
    name: `owner:${owner.kind}`,
    parse: () => parseManagedSiteContentValue({ ...contentValue("plain_text", "copy"), owner: extra(owner) }),
  }));
}

function exactRenderedContentValues(): readonly Record<string, unknown>[] {
  const rich = richTextDocument([
    { type: "paragraph", content: [{ type: "text", text: "copy" }] },
  ]);
  return [
    contentValue("plain_text", "copy"),
    contentValue("heading_text", "Heading"),
    contentValue("rich_text", rich),
    contentValue("link", {
      label: "Contact",
      destination: { kind: "internal", pageId: stableId("page"), fragment: "contact" },
      target: "same_window",
    }),
    contentValue("image", imageValue()),
    contentValue("collection", { orderedItemIds: [stableId("item")] }),
  ];
}

function exactInternalContentValues(): readonly Record<string, unknown>[] {
  return [
    internalValue("string", "copy"),
    internalValue("url", "https://example.com"),
    internalValue("boolean", true),
    internalValue("number", 1),
    internalValue("string_list", ["one"]),
    internalValue("postal_address", {
      streetAddress: "1 Main", addressLocality: "Toronto", addressRegion: "ON",
      postalCode: "M5V 2T6", addressCountry: "CA",
    }),
    internalValue("geo_coordinates", { latitude: 43, longitude: -79 }),
    internalValue("opening_hours", { timeZone: "Etc/UTC", periods: [] }),
    internalValue("indexing_directives", {
      index: true, follow: true, archive: true, imageIndex: true, maxSnippet: -1,
      maxImagePreview: "large", maxVideoPreview: -1,
    }),
    internalValue("json", { arbitrary: true }),
  ];
}

function exactContentValues(): readonly ExactKeyCase[] {
  const values = [...exactRenderedContentValues(), ...exactInternalContentValues()];
  return values.map((value) => ({
    name: `content:${String(value.type)}:${String(value.valueType ?? "")}`,
    parse: () => parseManagedSiteContentValue(extra(value)),
  }));
}

function exactDestinations(): readonly ExactKeyCase[] {
  const destinations = [
    { kind: "internal", pageId: stableId("page"), fragment: null },
    { kind: "external", url: "https://example.com" },
    { kind: "email", address: "hello@example.com" },
    { kind: "phone", number: "+14165550123" },
  ];
  return destinations.map((destination) => ({
    name: `destination:${destination.kind}`,
    parse: () => parseManagedSiteContentValue(contentValue("link", {
      label: "Contact", destination: extra(destination), target: "same_window",
    })),
  }));
}

function exactRichTextNodes(): readonly ExactKeyCase[] {
  const text = { type: "text", text: "copy" };
  const linkMark = {
    type: "link",
    destination: { kind: "external", url: "https://example.com" },
    target: "same_window",
  };
  const paragraph = { type: "paragraph", content: [text] };
  const listItem = { type: "list_item", content: [paragraph] };
  const blocks = [
    paragraph,
    { type: "bullet_list", content: [listItem] },
    { type: "ordered_list", content: [listItem] },
  ];
  return [
    { name: "rich:inline:text", parse: () => parseManagedRichTextDocument(richTextDocument([{ ...paragraph, content: [extra(text)] }])) },
    { name: "rich:mark:link", parse: () => parseManagedRichTextDocument(richTextDocument([{ ...paragraph, content: [{ ...text, marks: [extra(linkMark)] }] }])) },
    ...blocks.map((block) => ({
      name: `rich:block:${block.type}`,
      parse: () => parseManagedRichTextDocument(richTextDocument([extra(block)])),
    })),
    {
      name: "rich:list_item",
      parse: () => parseManagedRichTextDocument(richTextDocument([{ type: "bullet_list", content: [extra(listItem)] }])),
    },
  ];
}

function exactAssetSemantics(): readonly ExactKeyCase[] {
  const cases = [
    [{ kind: "decorative" }, { ...imageValue(), altText: "" }],
    [{ kind: "informative" }, imageValue()],
    [{ kind: "fixed_alt", altText: "Canonical alt" }, { ...imageValue(), altText: null }],
  ] as const;
  return cases.map(([semantics, image]) => ({
    name: `asset:${semantics.kind}`,
    parse: () => validateManagedImageValue({ ...assetSlot(), semantics: extra(semantics) }, image),
  }));
}

function exactRoutes(): readonly ExactKeyCase[] {
  const routes = [
    { kind: "static", path: "/services" },
    {
      kind: "generated", pattern: "/services/[slug]",
      collectionId: stableId("collection"), routeKeyFieldId: stableId("field"),
    },
  ];
  return routes.map((route) => ({
    name: `route:${route.kind}`,
    parse: () => {
      const contract = managedSiteContract();
      (contract.pages as Record<string, unknown>[])[0].route = extra(route);
      return parseManagedSiteContractV1(contract);
    },
  }));
}

function exactRedirectDestinations(): readonly ExactKeyCase[] {
  const destinations = [
    { kind: "page", pageId: stableId("page") },
    { kind: "external", url: "https://example.com/new" },
  ];
  return destinations.map((destination) => ({
    name: `redirect:${destination.kind}`,
    parse: () => {
      const seo = seoDescriptor();
      const redirect = (seo.redirects as Record<string, unknown>[])[0];
      redirect.destination = extra(destination);
      return parseManagedSiteSeoDescriptor(seo);
    },
  }));
}

function exactOpeningPeriods(): readonly ExactKeyCase[] {
  const periods = [
    { days: ["monday"], allDay: true, opens: null, closes: null },
    { days: ["tuesday"], allDay: false, opens: "09:00", closes: "17:00" },
  ];
  return periods.map((period) => ({
    name: `opening-period:${String(period.allDay)}`,
    parse: () => parseManagedSiteContentValue(internalValue("opening_hours", {
      timeZone: "Etc/UTC", periods: [extra(period)],
    })),
  }));
}

describe("v1 exact-key unions", () => {
  it("rejects unknown keys on every discriminated object variant", () => {
    const cases = [
      ...exactRenderedFields(), ...exactItemFields(), ...exactOwners(),
      ...exactContentValues(), ...exactDestinations(), ...exactRichTextNodes(),
      ...exactAssetSemantics(), ...exactRoutes(), ...exactRedirectDestinations(),
      ...exactOpeningPeriods(),
    ];
    for (const candidate of cases) assert.throws(candidate.parse, candidate.name);
  });
});
