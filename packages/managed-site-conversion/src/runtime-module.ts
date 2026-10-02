import { basename, dirname, extname, join, relative } from "node:path";

import type { Proposal } from "./propose.js";
import { RUNTIME_READERS } from "./runtime-readers.js";

export { RUNTIME_READERS };

/**
 * The per-site runtime module, generated rather than written by hand.
 *
 * Every converted site needs the same exports, and all that differs between
 * two sites is which content documents there are to import. Writing it by hand
 * per site would be one more artefact to keep in step with the contract, and
 * the first version of it drifted twice: once hardcoding an owner, once
 * hardcoding a value type, both of which threw at prerender on the first page
 * whose field did not match. Everything site-specific here is READ FROM THE
 * CONTRACT at module scope instead.
 */
export const RUNTIME_FILE = "managed-site.ts";

/**
 * The contract's filename beside the runtime.
 *
 * Stated HERE because this module writes the import that reads it; the CLI
 * writes the file and defers to this name rather than repeating it, so the two
 * cannot drift into a runtime importing a path nothing wrote.
 */
export const CONTRACT_FILE = "managed-site.contract.json";

/**
 * The anchor-to-ID ledger, beside the contract it mints IDs for.
 *
 * Named here, with the other file this tool owns, so the CLI's default and the
 * exclusion that keeps it out of the name scan cannot drift from each other.
 */
export const LEDGER_FILE = "managed-site.idmap.json";

/** A JS identifier for the document at `path`, unique within the module. */
function bindingFor(path: string, taken: Set<string>): string {
  const stem = basename(path, extname(path));
  const parts = [...dirname(path).split("/").slice(-1), stem].filter(
    (part) => part !== "" && part !== ".",
  );
  const camel = parts
    .join("-")
    .split(/[^a-zA-Z0-9]+/u)
    .filter((part) => part !== "")
    .map((part, index) =>
      index === 0
        ? part.charAt(0).toLowerCase() + part.slice(1)
        : part.charAt(0).toUpperCase() + part.slice(1),
    )
    .join("");
  const base = `${/^[a-z]/iu.test(camel) ? camel : `doc${camel}`}Document`;
  let name = base;
  let suffix = 2;
  while (taken.has(name)) {
    name = `${base}${String(suffix)}`;
    suffix += 1;
  }
  taken.add(name);
  return name;
}

export interface RuntimeModule {
  /** Repository-relative path the module belongs at. */
  readonly path: string;
  readonly text: string;
}

/**
 * What the readers add to the module main's generator wrote, as three pieces,
 * each inserted whole: names in the contract import, two module imports, and a
 * suffix. Nothing else in the text differs from main's, which
 * `runtime-readers.test.ts` checks by removing exactly these from every
 * fixture's output and comparing the rest with main's own output.
 */
export const READER_CONTRACT_IMPORTS = `  isManagedServedAssetPath,
  MANAGED_SERVED_ASSET_ROOT,
  parseManagedRichTextDocument,
  parseManagedSiteContentValue,
  resolveManagedImageAltText,
  validateManagedImageValue,
  type ManagedCollectionItemField,
  type ManagedFieldDescriptor,
  type ManagedImageValue,
  type ManagedLinkDestination,
  type ManagedLinkTarget,
  type ManagedSiteContentValue,
`;

export const READER_MODULE_IMPORTS = `import type { Metadata } from "next";
`;

/**
 * `contentRoot` is where the documents live, and the runtime sits beside them
 * so every import is a sibling path -- the specifier the rewrite emits names
 * this file, and the two must agree without either restating the other's
 * directory.
 */
export function runtimeModule(
  proposal: Pick<Proposal, "sourceDocuments">,
  contentRoot: string,
): RuntimeModule {
  const taken = new Set<string>(["contractDocument"]);
  const documents = [...proposal.sourceDocuments.keys()].sort().map((path) => ({
    path,
    binding: bindingFor(path, taken),
    specifier: `./${relative(contentRoot, path)}`,
  }));
  const imports = documents
    .map(
      (document) =>
        `import ${document.binding} from ${JSON.stringify(document.specifier)};`,
    )
    .join("\n");
  const entries = documents
    .map(
      (document) =>
        `  { path: ${JSON.stringify(document.path)}, value: ${document.binding} },`,
    )
    .join("\n");
  return {
    path: join(contentRoot, RUNTIME_FILE),
    text: `/**
 * The managed-site runtime. GENERATED -- do not edit.
 *
 * Written by the conversion tool beside the content documents it reads. The
 * contract is data, the reader is keyed on a field id, and the rewritten
 * components call \`managedText\` and friends by name. Nothing here is specific
 * to this site except which documents there are to import: an owner and a value
 * type are read from the contract, never restated.
 */
import {
  createManagedSiteNextV1,
  groupManagedRichTextInlines,
  managedRichTextBlockInlines,
  managedRichTextBreakAttributesV1,
  managedRichTextLinkAttributesV1,
  managedRichTextMarkAttributesV1,
  managedSiteFieldAttributesV1,
  managedSitePageAttributesV1,
${READER_CONTRACT_IMPORTS}  type ManagedRichTextDocument,
  type ManagedRichTextLinkAttributesV1,
  type ManagedRichTextSpan,
  type ManagedSiteFieldAttributesV1,
  type ManagedSitePageAttributesV1,
} from "@landing-pages-websites/managed-site-contract";
${READER_MODULE_IMPORTS}import { createElement, Fragment, type ReactNode } from "react";

import contractDocument from "./${CONTRACT_FILE}";
${imports}

const sourceDocuments = [
${entries}
];

const site = createManagedSiteNextV1({ contract: contractDocument, sourceDocuments });

type Owner = Parameters<typeof site.readValue>[0]["owner"];
type ValueType = Parameters<typeof site.readValue>[0]["type"];

interface FieldSelector {
  readonly owner: Owner;
  readonly type: ValueType;
}

/**
 * Where each field's value lives, derived once from the contract.
 *
 * A field's owner is its scope -- site-wide, or the one page that uses it --
 * and a collection item's fields are owned by the item. Deriving all three from
 * the contract is what keeps this module identical across sites.
 */
const selectors = new Map<string, FieldSelector>();
for (const page of contractDocument.pages) {
  for (const section of page.sections) {
    for (const field of section.fields) {
      const usage = field.usages[0];
      selectors.set(field.id, {
        owner:
          field.scope === "site"
            ? { kind: "site" }
            : { kind: "page", pageId: (usage?.pageId ?? page.id) as never },
        type: field.type as ValueType,
      });
    }
  }
}

const collectionFields = new Map<string, ReadonlyMap<string, ValueType>>();
for (const collection of contractDocument.collections) {
  collectionFields.set(
    collection.id,
    new Map(collection.itemFields.map((field) => [field.id, field.type as ValueType])),
  );
}

function pointerInto(document: unknown, pointer: string): unknown {
  return pointer
    .split("/")
    .slice(1)
    .reduce<unknown>(
      (node, token) =>
        typeof node === "object" && node !== null
          ? (node as Record<string, unknown>)[
              token.replace(/~1/gu, "/").replace(/~0/gu, "~")
            ]
          : undefined,
      document,
    );
}

/**
 * A collection's item ids in the order its SOURCE document lists them.
 *
 * NOT the order the contract's collection field holds. That value is
 * \`orderedItemIds\`, which is the customer's presentation order and is
 * theirs to change; the source array is the repository's own, and it is what
 * the rewritten template maps over. Joining a rendered row to an item by
 * position in the customer's order meant that reordering the collection in the
 * editor left a row keeping one item's icon and click behaviour while showing
 * and annotating another item's words. The two agree at conversion, which is
 * why nothing caught it until a reviewer reasoned about the editor.
 *
 * An item's identity comes from the collection's own \`itemIdPointer\`, so it
 * survives anything the platform does to the order.
 */
const sourceItemIdsOf = new Map<string, readonly string[]>();
for (const collection of contractDocument.collections) {
  const document = sourceDocuments.find(
    (entry) => entry.path === collection.resolver.path,
  )?.value;
  const items = pointerInto(document, collection.resolver.pointer);
  if (!Array.isArray(items)) {
    throw new Error(
      \`managed-site: \${collection.id} does not resolve to an array of items\`,
    );
  }
  sourceItemIdsOf.set(
    collection.id,
    items.map((item, index) => {
      const itemId = pointerInto(item, collection.itemIdPointer);
      if (typeof itemId !== "string") {
        throw new Error(
          \`managed-site: \${collection.id} item \${String(index)} has no id at \${collection.itemIdPointer}\`,
        );
      }
      return itemId;
    }),
  );
}

function sourceItemIds(collectionId: string): readonly string[] {
  const itemIds = sourceItemIdsOf.get(collectionId);
  if (itemIds === undefined) {
    throw new Error(\`managed-site: \${collectionId} is not a collection in the contract\`);
  }
  return itemIds;
}

function selectorFor(fieldId: string): FieldSelector {
  const selector = selectors.get(fieldId);
  if (selector === undefined) {
    throw new Error(\`managed-site: \${fieldId} is not a field in the contract\`);
  }
  return selector;
}

/**
 * The reader is generic on the value TYPE, so a type passed as \`never\`
 * collapses its return to \`never\` and every read stops compiling. The union
 * goes in as itself and the caller narrows what comes back.
 */
function readValue(fieldId: string, selector: FieldSelector): { readonly value: unknown } {
  return site.readValue({
    fieldId: fieldId as never,
    owner: selector.owner,
    type: selector.type,
  });
}

function textOf(fieldId: string, selector: FieldSelector): string {
  const { value } = readValue(fieldId, selector);
  if (typeof value !== "string") {
    throw new Error(\`managed-site: \${fieldId} is not a text value\`);
  }
  return value;
}

export interface ManagedField {
  readonly value: string;
  readonly attributes: ManagedSiteFieldAttributesV1;
}

/** Every field a client component needs, keyed by id. */
export type ManagedFields = Readonly<Record<string, ManagedField>>;

export function managedText(fieldId: string): ManagedField {
  return {
    value: textOf(fieldId, selectorFor(fieldId)),
    attributes: managedSiteFieldAttributesV1(fieldId as never),
  };
}

/**
 * The record a server component hands to a client one.
 *
 * A client module cannot call this runtime at all -- the contract package reads
 * \`node:crypto\` -- so the values are resolved here and passed as a prop.
 */
export function managedFieldsFor(fieldIds: readonly string[]): ManagedFields {
  return Object.fromEntries(fieldIds.map((fieldId) => [fieldId, managedText(fieldId)]));
}

/** One collection's items, each a record of its fields keyed by field id. */
export type ManagedItems = Readonly<Record<string, readonly ManagedFields[]>>;

/**
 * The items a CLIENT component needs, resolved here and passed as a prop.
 *
 * A client module cannot call this runtime at all, and a collection's items
 * cannot be threaded as \`managedFields\` either: every item carries the same
 * field ids, so one record keyed by field id could only hold one of them. The
 * items are keyed by collection and then by the position the SOURCE document
 * lists them at, which is the same index \`managedItem\` uses on the server
 * and the same one the rewritten template maps over.
 */
export function managedItemsFor(collectionIds: readonly string[]): ManagedItems {
  return Object.fromEntries(
    collectionIds.map((collectionId) => {
      const fields = collectionFields.get(collectionId);
      if (fields === undefined) {
        throw new Error(\`managed-site: \${collectionId} is not a collection in the contract\`);
      }
      const itemIds = sourceItemIds(collectionId);
      // Only the fields this record can REPRESENT. It is built eagerly, so a
      // field whose value is not text -- a link, whose value is an object of
      // label, destination and target -- would throw here for every item,
      // before the component it is for ever renders. The server path reads one
      // field at a time and never asks for those, which is why only this side
      // needs saying. A field left out simply is not in the record, and the
      // rewritten read falls back to the expression already written.
      const textFields = [...fields].filter(
        ([, type]) => type === "plain_text" || type === "heading_text",
      );
      return [
        collectionId,
        itemIds.map((itemId) =>
          Object.fromEntries(
            textFields.map(([fieldId, type]) => [
              fieldId,
              {
                value: textOf(fieldId, {
                  owner: {
                    kind: "collection_item",
                    collectionId: collectionId as never,
                    itemId: itemId as never,
                  },
                  type,
                }),
                attributes: managedSiteFieldAttributesV1(fieldId as never, itemId as never),
              },
            ]),
          ),
        ),
      ];
    }),
  );
}

/**
 * The site's own element for each mark, written by the conversion from the
 * element the source used. Each carries \`data-gomega-mark\` so an editor
 * previewing a change can find and reuse it.
 */
/**
 * What a link mark's element takes from the value: the contract's href and
 * target, and the rel a new window needs, since a page opened with
 * target="_blank" and no rel="noopener noreferrer" can reach back into this
 * one. The ONE builder every link in this module goes through -- the fallback
 * anchor, a site's own link template (the rewrite spreads rel={link.rel}),
 * whole documents and link fields -- so no two can disagree on rel again.
 */
export type ManagedRichTextLink = ManagedRichTextLinkAttributesV1 & {
  readonly rel: "noopener noreferrer" | undefined;
};

export interface ManagedRichTextTemplates {
  readonly bold?: (children: ReactNode) => ReactNode;
  readonly italic?: (children: ReactNode) => ReactNode;
  readonly link?: (children: ReactNode, link: ManagedRichTextLink) => ReactNode;
  /**
   * The site's own element for a line break: the source's \`<br>\`, or a line
   * wrapper of its own. Whatever it renders carries \`data-gomega-break\`.
   */
  readonly hard_break?: () => ReactNode;
}

export interface ManagedRichText {
  readonly content: ReactNode;
  readonly attributes: ManagedSiteFieldAttributesV1;
}

/**
 * A mark the site has no element for -- one the value holds that the source
 * block never used -- renders as the plain semantic element, so it is still
 * visible and still findable rather than dropped.
 */
const FALLBACK_MARK_TAG = { bold: "strong", italic: "em", link: "a" } as const;

type MarkSpan = Extract<ManagedRichTextSpan, { readonly kind: "mark" }>;

function renderSpans(
  spans: readonly ManagedRichTextSpan[],
  templates: ManagedRichTextTemplates,
): ReactNode {
  // Children as arguments rather than an array, so React sees them as written
  // in place and asks for no keys.
  return createElement(
    Fragment,
    null,
    ...spans.map((span) => {
      if (span.kind === "text") return span.text;
      if (span.kind === "hard_break") return renderBreak(templates);
      return renderMark(span, templates);
    }),
  );
}

/**
 * A line break through the site's element for it, or a plain \`<br>\` carrying
 * the break annotation when the source block drew none.
 */
function renderBreak(templates: ManagedRichTextTemplates): ReactNode {
  return templates.hard_break?.() ?? createElement("br", managedRichTextBreakAttributesV1());
}

/**
 * A page's path, for an internal prose link. The contract admits a link to any
 * live page, so the renderer must resolve every one it can be given: a static
 * page is its path. A generated page is a pattern with no item to fill it, so
 * it has no single path and fails the build loudly, naming the page, rather
 * than rendering a link that goes nowhere.
 */
function pagePath(pageId: string): string {
  const page = contractDocument.pages.find((candidate) => candidate.id === pageId);
  if (page === undefined) {
    throw new Error(\`managed-site: \${pageId} is not a page in the contract\`);
  }
  const route = page.route as { readonly kind: string; readonly path?: string };
  if (route.kind !== "static" || route.path === undefined) {
    throw new Error(\`managed-site: \${pageId} has no single path to link to\`);
  }
  return route.path;
}

function managedRichTextLink(mark: Extract<MarkSpan["mark"], { readonly type: "link" }>): ManagedRichTextLink {
  const link = managedRichTextLinkAttributesV1(mark, pagePath);
  return { ...link, rel: link.target === "_blank" ? "noopener noreferrer" : undefined };
}

function renderMark(span: MarkSpan, templates: ManagedRichTextTemplates): ReactNode {
  const children = renderSpans(span.children, templates);
  const mark = span.mark;
  if (mark.type === "link") {
    const link = managedRichTextLink(mark);
    return (
      templates.link?.(children, link) ??
      createElement(
        FALLBACK_MARK_TAG.link,
        { ...link, ...managedRichTextMarkAttributesV1("link") },
        children,
      )
    );
  }
  return (
    templates[mark.type]?.(children) ??
    createElement(FALLBACK_MARK_TAG[mark.type], managedRichTextMarkAttributesV1(mark.type), children)
  );
}

/**
 * A formatted block rendered in place: its one paragraph or heading, each mark
 * through the site's own element. The field's annotation goes on the element
 * the block renders in, exactly as a text field's does.
 */
function richTextSelector(fieldId: string): FieldSelector {
  const selector = selectorFor(fieldId);
  if (selector.type !== "rich_text") {
    throw new Error(\`managed-site: \${fieldId} is not a rich-text field\`);
  }
  return selector;
}

/** A rich-text field's annotation alone, without reading or rendering its value. */
export function managedRichTextAttributes(fieldId: string): ManagedSiteFieldAttributesV1 {
  richTextSelector(fieldId);
  return managedSiteFieldAttributesV1(fieldId as never);
}

export function managedRichText(
  fieldId: string,
  templates: ManagedRichTextTemplates,
): ManagedRichText {
  const { value } = readValue(fieldId, richTextSelector(fieldId));
  const inlines = managedRichTextBlockInlines(value as ManagedRichTextDocument);
  return {
    content: renderSpans(groupManagedRichTextInlines(inlines), templates),
    attributes: managedSiteFieldAttributesV1(fieldId as never),
  };
}

export function managedPage(pageId: string): ManagedSitePageAttributesV1 {
  return managedSitePageAttributesV1(pageId as never);
}

export interface ManagedItem {
  value(fieldId: string): string;
  attributes(fieldId: string): ManagedSiteFieldAttributesV1;
}

/**
 * One item of a collection, by its position in the SOURCE document's items.
 *
 * The template maps over the repository's own array, so that position -- not
 * the customer's \`orderedItemIds\` -- is what connects a rendered row to an
 * item. See \`sourceItemIdsOf\`.
 */
export function managedItem(collectionId: string, index: number): ManagedItem {
  const fields = collectionFields.get(collectionId);
  if (fields === undefined) {
    throw new Error(\`managed-site: \${collectionId} is not a collection in the contract\`);
  }
  const itemId = sourceItemIds(collectionId)[index];
  if (itemId === undefined) {
    throw new Error(\`managed-site: \${collectionId} has no item at \${String(index)}\`);
  }
  return {
    value(fieldId: string): string {
      const type = fields.get(fieldId);
      if (type === undefined) {
        throw new Error(\`managed-site: \${fieldId} is not a field of \${collectionId}\`);
      }
      return textOf(fieldId, {
        owner: { kind: "collection_item", collectionId: collectionId as never, itemId: itemId as never },
        type,
      });
    },
    attributes(fieldId: string): ManagedSiteFieldAttributesV1 {
      return managedSiteFieldAttributesV1(fieldId as never, itemId as never);
    },
  };
}
${RUNTIME_READERS}`,
  };
}
