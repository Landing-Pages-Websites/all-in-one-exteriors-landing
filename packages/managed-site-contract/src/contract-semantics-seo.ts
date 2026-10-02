import type {
  ManagedPageDescriptor,
  ManagedSiteContractV1,
} from "./contract.js";
import { ManagedSiteContractError } from "./errors.js";
import type {
  ManagedCollectionDescriptor,
  ManagedCollectionItemField,
  ManagedFieldDescriptor,
} from "./fields.js";
import type { ManagedInternalValueType } from "./internal-value-types.js";
import type { ManagedGeneratedPageSeoDescriptor } from "./seo.js";
import {
  MANAGED_METADATA_SLOT_POLICY,
  metadataFieldReferences,
  validateStaticPageMetadata,
} from "./contract-semantics-seo-metadata.js";
import { MANAGED_RICH_TEXT_HEADING_LEVELS } from "./rich-text.js";
import { isManagedGeneratedRouteSegment } from "./values.js";

type GeneratedRoute = Extract<ManagedPageDescriptor["route"], { kind: "generated" }>;

function fail(code: string, message: string): never {
  throw new ManagedSiteContractError(code, message);
}

function indexByPageId<T extends { readonly pageId: string }>(
  descriptors: readonly T[],
): ReadonlyMap<string, T> {
  const indexed = new Map<string, T>();
  for (const descriptor of descriptors) {
    if (indexed.has(descriptor.pageId)) {
      fail(
        "CONTRACT_SEO_PAGE_DUPLICATE",
        `SEO page descriptor repeats ${descriptor.pageId}`,
      );
    }
    indexed.set(descriptor.pageId, descriptor);
  }
  return indexed;
}

function collectionById(
  contract: ManagedSiteContractV1,
  collectionId: string,
): ManagedCollectionDescriptor {
  const collection = contract.collections.find(
    (candidate) => candidate.id === collectionId,
  );
  if (collection === undefined) {
    fail(
      "CONTRACT_SEO_GENERATED_COLLECTION",
      `Generated SEO collection is unresolved: ${collectionId}`,
    );
  }
  return collection;
}

function fieldById(
  collection: ManagedCollectionDescriptor,
  fieldId: string,
): ManagedCollectionItemField {
  const field = collection.itemFields.find((candidate) => candidate.id === fieldId);
  if (field === undefined) {
    fail(
      "CONTRACT_SEO_FIELD_POLICY",
      `Generated SEO field is outside collection ${collection.id}: ${fieldId}`,
    );
  }
  return field;
}

function requireProtectedField(
  collection: ManagedCollectionDescriptor,
  fieldId: string,
  valueType: ManagedInternalValueType,
  semantic: string,
): void {
  const field = fieldById(collection, fieldId);
  if (
    field.type !== "internal_protected" ||
    field.valueType !== valueType ||
    field.semantic !== semantic
  ) {
    fail(
      "CONTRACT_SEO_FIELD_POLICY",
      `Generated SEO field has unsafe authority or type: ${fieldId}`,
    );
  }
}

function validateMetadata(
  collection: ManagedCollectionDescriptor,
  descriptor: ManagedGeneratedPageSeoDescriptor,
): void {
  const { metadata } = descriptor;
  // A generated page has no editable half: every slot names its protected field.
  for (const reference of metadataFieldReferences(metadata)) {
    const policy = MANAGED_METADATA_SLOT_POLICY[reference.slot];
    requireProtectedField(collection, reference.fieldId, policy.valueType, policy.semantic);
  }
  if (metadata.social.imageFieldId !== null) {
    requireImageField(collection, metadata.social.imageFieldId);
  }
}

function requireImageField(
  collection: ManagedCollectionDescriptor,
  fieldId: string,
): void {
  if (fieldById(collection, fieldId).type !== "image") {
    fail(
      "CONTRACT_SEO_FIELD_POLICY",
      `Generated SEO image does not resolve to an image field: ${fieldId}`,
    );
  }
}

function isSiteScopedField(
  contract: ManagedSiteContractV1,
  fieldId: string,
): boolean {
  const protectedField = contract.internalSeo.protectedFields.find(
    (field) => field.id === fieldId,
  );
  if (protectedField !== undefined) return protectedField.scope === "site";
  return contract.pages.some((page) =>
    page.sections.some((section) =>
      section.fields.some(
        (field) => field.id === fieldId && field.scope === "site",
      ),
    ),
  );
}

function validateSiteJsonLdSources(
  contract: ManagedSiteContractV1,
  descriptor: ManagedGeneratedPageSeoDescriptor,
): void {
  for (const declaration of descriptor.jsonLd) {
    for (const fieldId of declaration.siteSourceFieldIds) {
      if (!isSiteScopedField(contract, fieldId)) {
        fail(
          "CONTRACT_SEO_FIELD_POLICY",
          `Generated JSON-LD site source is not site-scoped: ${fieldId}`,
        );
      }
    }
  }
}

function validateHeadingOutline(
  collection: ManagedCollectionDescriptor,
  descriptor: ManagedGeneratedPageSeoDescriptor,
): void {
  const h1Count = descriptor.headingOutline.filter(
    (heading) => heading.semanticLevel === 1,
  ).length;
  if (h1Count !== 1) {
    fail(
      "CONTRACT_SEO_FIELD_POLICY",
      `Generated page must declare exactly one H1: ${descriptor.pageId}`,
    );
  }
  for (const heading of descriptor.headingOutline) {
    const field = fieldById(collection, heading.fieldId);
    if (field.type !== "heading_text" || field.semanticLevel !== heading.semanticLevel) {
      fail(
        "CONTRACT_SEO_FIELD_POLICY",
        `Generated heading outline conflicts with field ${heading.fieldId}`,
      );
    }
  }
}

function validateRouteKey(
  collection: ManagedCollectionDescriptor,
  route: GeneratedRoute,
): void {
  const field = fieldById(collection, route.routeKeyFieldId);
  const protectedSlug =
    field.type === "internal_protected" &&
    field.valueType === "string" &&
    field.semantic === "route.slug";
  const uniquelyIndexed = collection.uniqueness.some(
    (rule) =>
      rule.comparison === "exact" &&
      rule.fieldIds.length === 1 &&
      rule.fieldIds[0] === route.routeKeyFieldId,
  );
  if (!protectedSlug || !uniquelyIndexed) {
    fail(
      "CONTRACT_SEO_FIELD_POLICY",
      `Generated route key is not a protected unique slug: ${route.routeKeyFieldId}`,
    );
  }
}

function validateRoutePattern(route: GeneratedRoute): void {
  const parameterCount = route.pattern
    .slice(1)
    .split("/")
    .filter(isManagedGeneratedRouteSegment).length;
  if (parameterCount !== 1) {
    fail(
      "CONTRACT_SEO_ROUTE_PATTERN",
      `Generated route must contain exactly one parameter: ${route.pattern}`,
    );
  }
}

function validateGeneratedDescriptor(
  contract: ManagedSiteContractV1,
  page: ManagedPageDescriptor,
  descriptor: ManagedGeneratedPageSeoDescriptor,
): void {
  if (page.route.kind !== "generated") {
    fail("CONTRACT_SEO_PAGE_ROUTE", `Generated SEO targets a static page: ${page.id}`);
  }
  if (descriptor.collectionId !== page.route.collectionId) {
    fail(
      "CONTRACT_SEO_GENERATED_COLLECTION",
      `Generated SEO collection conflicts with route ${page.id}`,
    );
  }
  const collection = collectionById(contract, descriptor.collectionId);
  validateRoutePattern(page.route);
  validateRouteKey(collection, page.route);
  validateMetadata(collection, descriptor);
  validateHeadingOutline(collection, descriptor);
  validateSiteJsonLdSources(contract, descriptor);
  if (descriptor.primaryImageFieldId !== null) {
    requireImageField(collection, descriptor.primaryImageFieldId);
  }
}

function validateDescriptorRoutes(contract: ManagedSiteContractV1): void {
  const pages = new Map(contract.pages.map((page) => [page.id, page]));
  for (const descriptor of contract.internalSeo.pages) {
    const page = pages.get(descriptor.pageId);
    if (page?.route.kind !== "static") {
      fail("CONTRACT_SEO_PAGE_ROUTE", `Static SEO targets a generated page: ${descriptor.pageId}`);
    }
  }
  for (const descriptor of contract.internalSeo.generatedPages) {
    const page = pages.get(descriptor.pageId);
    if (page === undefined) continue;
    validateGeneratedDescriptor(contract, page, descriptor);
  }
}

function validateCoverage(contract: ManagedSiteContractV1): void {
  const staticSeo = indexByPageId(contract.internalSeo.pages);
  const generatedSeo = indexByPageId(contract.internalSeo.generatedPages);
  for (const page of contract.pages) {
    const covered =
      page.route.kind === "static"
        ? staticSeo.has(page.id) && !generatedSeo.has(page.id)
        : generatedSeo.has(page.id) && !staticSeo.has(page.id);
    if (!covered) {
      fail("CONTRACT_SEO_PAGE_COVERAGE", `Page has no exact SEO coverage: ${page.id}`);
    }
  }
}

function renderedFieldsById(contract: ManagedSiteContractV1): ReadonlyMap<string, ManagedFieldDescriptor> {
  return new Map(contract.pages.flatMap((page) =>
    page.sections.flatMap((section) => section.fields.map((field) => [field.id, field] as const))));
}

/**
 * A field whose rendered output can carry a heading at `level`, on this page:
 * a heading field at exactly that level, or a rich-text field that admits a
 * heading block, whose levels the grammar bounds. A rich-text field that
 * admits only paragraphs renders no heading the contract can see, even when
 * code wraps it in one, so it is refused at any level.
 */
function namesHeading(field: ManagedFieldDescriptor | undefined, level: number, pageId: string): boolean {
  if (field === undefined || !field.usages.some((usage) => usage.pageId === pageId)) return false;
  if (field.type === "heading_text") return field.semanticLevel === level;
  if (field.type !== "rich_text") return false;
  return field.constraints.allowedBlocks.includes("heading") &&
    (MANAGED_RICH_TEXT_HEADING_LEVELS as readonly number[]).includes(level);
}

/**
 * A static page's outline, as a generated page's is: at most one H1 (a static
 * page may declare none, since a converted page states only the headings its
 * source marks), and every entry a heading.
 */
function validateStaticHeadingOutlines(contract: ManagedSiteContractV1): void {
  const fields = renderedFieldsById(contract);
  for (const descriptor of contract.internalSeo.pages) {
    const h1Count = descriptor.headingOutline.filter((heading) => heading.semanticLevel === 1).length;
    if (h1Count > 1) {
      fail("CONTRACT_SEO_FIELD_POLICY", `Static page declares more than one H1: ${descriptor.pageId}`);
    }
    for (const heading of descriptor.headingOutline) {
      if (!namesHeading(fields.get(heading.fieldId), heading.semanticLevel, descriptor.pageId)) {
        fail("CONTRACT_SEO_FIELD_POLICY", `Static heading outline names a field that is not a heading: ${heading.fieldId}`);
      }
    }
  }
}

export function validateManagedSiteSeoSemantics(
  contract: ManagedSiteContractV1,
): void {
  validateDescriptorRoutes(contract);
  validateStaticPageMetadata(contract);
  validateStaticHeadingOutlines(contract);
  validateCoverage(contract);
}
