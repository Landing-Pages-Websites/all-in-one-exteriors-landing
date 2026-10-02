import type { ManagedSiteContentDocument, ManagedSiteContentValue } from "./content.js";
import type { ManagedSiteContractV1 } from "./contract.js";
import type { ManagedCollectionItemField, ManagedFieldDescriptor } from "./fields.js";

type AnyField = ManagedFieldDescriptor | ManagedCollectionItemField;

/**
 * Where a page's H1 comes from, read from every field the page renders: its
 * own sections' fields, site-wide fields it uses, and the item fields of
 * every collection it renders (a collection field on the page, or a generated
 * page's own collection). Shared by the compatibility policy and content
 * semantics, and exported so a CMS can apply the same reading.
 */
export interface ManagedRenderedH1Sources {
  /** Level 1 heading fields the page renders. */
  readonly headingFields: readonly string[];
  /** Rich-text fields whose content, as rendered on the page, holds a level 1 heading block. */
  readonly richTextFields: readonly string[];
  /** Rich-text fields with a value, as rendered on the page, holding more than one level 1 block. */
  readonly repeatedRichTextFields: readonly string[];
  /** Fields the page's outline names at level 1. */
  readonly outlined: readonly string[];
}

function outlineOf(contract: ManagedSiteContractV1, pageId: string): readonly { readonly fieldId: string; readonly semanticLevel: number }[] {
  const { pages, generatedPages } = contract.internalSeo;
  return [...pages, ...generatedPages].find((entry) => entry.pageId === pageId)?.headingOutline ?? [];
}

/** The collections a page renders: each collection field it uses, and a generated page's own collection. */
function renderedCollections(contract: ManagedSiteContractV1, pageId: string, sectionFields: readonly ManagedFieldDescriptor[]): ReadonlySet<string> {
  const listed = sectionFields.flatMap((field) => (field.type === "collection" ? [field.collectionId] : []));
  const route = contract.pages.find((page) => page.id === pageId)?.route;
  return new Set([...listed, ...(route?.kind === "generated" ? [route.collectionId] : [])]);
}

/** Every field a page renders, with the collections whose items it renders. */
function renderedFields(contract: ManagedSiteContractV1, pageId: string): { readonly fields: readonly AnyField[]; readonly collections: ReadonlySet<string> } {
  const sectionFields = contract.pages
    .flatMap((page) => page.sections.flatMap((section) => section.fields))
    .filter((field) => field.usages.some((usage) => usage.pageId === pageId));
  const collections = renderedCollections(contract, pageId, sectionFields);
  const itemFields = contract.collections
    .filter((collection) => collections.has(collection.id))
    .flatMap((collection) => collection.itemFields);
  return { fields: [...sectionFields, ...itemFields], collections };
}

/** Whether a value renders on the page: its own, site-wide, or an item of a collection the page renders. */
function rendersHere(value: ManagedSiteContentValue, pageId: string, collections: ReadonlySet<string>): boolean {
  if (value.owner.kind === "page") return value.owner.pageId === pageId;
  if (value.owner.kind === "site") return true;
  return collections.has(value.owner.collectionId);
}

/**
 * How many level 1 heading blocks a rich-text value holds. Headings are
 * top-level blocks only (a list item or quotation holds paragraphs), so the
 * top level is every place one can be.
 */
export function managedRichTextLevelOneHeadingCount(value: ManagedSiteContentValue): number {
  if (value.type !== "rich_text") return 0;
  return value.value.content.filter((block) => block.type === "heading" && block.attrs.level === 1).length;
}

/** Whether a rich-text value holds a level 1 heading block. */
export function managedRichTextHoldsLevelOneHeading(value: ManagedSiteContentValue): boolean {
  return managedRichTextLevelOneHeadingCount(value) > 0;
}

/** Every source of a page's H1, static or generated. */
export function managedRenderedH1Sources(
  contract: ManagedSiteContractV1,
  content: ManagedSiteContentDocument,
  pageId: string,
): ManagedRenderedH1Sources {
  const { fields, collections } = renderedFields(contract, pageId);
  const ids = new Set(fields.map((field) => field.id));
  const rendered = content.values.filter((value) => ids.has(value.fieldId) && rendersHere(value, pageId, collections));
  const withH1 = rendered.filter(managedRichTextHoldsLevelOneHeading).map((value) => value.fieldId);
  const repeated = rendered.filter((value) => managedRichTextLevelOneHeadingCount(value) > 1).map((value) => value.fieldId);
  return {
    headingFields: fields.filter((field) => field.type === "heading_text" && field.semanticLevel === 1).map((field) => field.id),
    richTextFields: [...new Set(withH1)],
    repeatedRichTextFields: [...new Set(repeated)],
    outlined: outlineOf(contract, pageId).filter((heading) => heading.semanticLevel === 1).map((heading) => heading.fieldId),
  };
}

/** The set of fields that render a page's H1: every source, once. */
export function managedPageH1Fields(
  contract: ManagedSiteContractV1,
  content: ManagedSiteContentDocument,
  pageId: string,
): ReadonlySet<string> {
  const sources = managedRenderedH1Sources(contract, content, pageId);
  return new Set([...sources.headingFields, ...sources.richTextFields, ...sources.outlined]);
}

/** Every page with an SEO entry, static and generated. */
export function managedSeoPageIds(contract: ManagedSiteContractV1): readonly string[] {
  return [...contract.internalSeo.pages, ...contract.internalSeo.generatedPages].map((entry) => entry.pageId);
}
