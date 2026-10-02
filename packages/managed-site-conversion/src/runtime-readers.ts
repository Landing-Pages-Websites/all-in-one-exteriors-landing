/**
 * The readers the generated runtime carries for values that are not plain
 * text: a collection's order, links, images, rich text and page metadata.
 *
 * Appended to `runtime-module.ts`'s output after every existing export. The
 * generated module differs from main's in exactly three places, each inserted
 * whole: names added to the contract import, the next and react imports, and
 * this suffix. `runtime-readers.test.ts`
 * removes those three from every fixture's output and compares the rest with
 * main's generator output byte for byte. Written as `String.raw`, so the text
 * must hold no backtick and no dollar-brace.
 *
 * The runtime is verified against one contract version, the one this package
 * depends on, so the CLI refuses to write it into a site whose contract
 * dependency is older (`runtime-requirements.ts`).
 *
 * THE INVARIANT: anything the contract package accepts must render. A reader
 * is exactly as strict as the contract and never stricter, because a reader
 * that throws on a value the CMS saved and Site Guard passed fails the site's
 * build after the fact: the deploy never becomes ready and the publish is
 * stuck with editing fenced. So no reader restates a rule. Every value check
 * is the contract package's own parser or validator, called on the value
 * being rendered, and what remains here is only the mapping from an accepted
 * value to markup, which is total. A reader still throws on a value the
 * contract refuses (fail closed), and on an id or field the CALLING CODE got
 * wrong, which a developer meets at their own build, never after a publish.
 *
 * `runtime-readers.test.ts` holds this to a differential table: for every
 * case, contract accepts implies the reader renders.
 */
export const RUNTIME_READERS = String.raw`
function refuse(message: string): never {
  throw new Error("managed-site: " + message);
}

type ContentValueOf<Type extends ManagedSiteContentValue["type"]> = Extract<
  ManagedSiteContentValue,
  { readonly type: Type }
>["value"];

function readTyped<Type extends ManagedSiteContentValue["type"]>(
  fieldId: string,
  owner: Owner,
  type: Type,
): ContentValueOf<Type> {
  return site.readValue({ fieldId: fieldId as never, owner, type }).value as ContentValueOf<Type>;
}

/** Every rendered field the contract declares, by id, as the contract states it. */
const fieldDescriptors = new Map<string, ManagedFieldDescriptor>(
  site.contract.pages.flatMap((page) =>
    page.sections.flatMap((section) => section.fields.map((field) => [field.id, field] as const)),
  ),
);

interface DeclaredField {
  readonly scope: "site" | "page";
  readonly usages: readonly { readonly pageId: string }[];
}

/** Every field with an owner of its own: rendered fields and protected SEO fields alike. */
const declaredFields = new Map<string, DeclaredField>([
  ...fieldDescriptors,
  ...site.contract.internalSeo.protectedFields.map((field) => [field.id, field] as const),
]);

/**
 * THE one place a reader decides whose a value is: from the field's own
 * declaration, exactly as the contract's projection stores it (requiredOwner
 * and projectProtectedField in source-projection-values.ts, neither exported):
 * site scope is the site, page scope is the page of the field's first usage.
 * Never the page being rendered -- a canonical declared for /about and named
 * from home's metadata is stored under /about. A collection item's owner is its
 * collection and item, which managedItemById builds from the contract's own
 * collection; nothing else builds one.
 */
function ownerOf(fieldId: string): Owner {
  const field = declaredFields.get(fieldId);
  if (field === undefined) return refuse(fieldId + " is not a field in the contract");
  if (field.scope === "site") return { kind: "site" };
  const [usage] = field.usages;
  if (usage === undefined) return refuse(fieldId + " is page-scoped with no usage, which the contract refuses");
  return { kind: "page", pageId: usage.pageId as never };
}

function fieldOfType<Type extends ManagedFieldDescriptor["type"]>(
  fieldId: string,
  type: Type,
): Extract<ManagedFieldDescriptor, { readonly type: Type }> {
  const field = fieldDescriptors.get(fieldId);
  if (field === undefined) return refuse(fieldId + " is not a field in the contract");
  if (field.type !== type) return refuse(fieldId + " is a " + field.type + " field, not " + type);
  return field as Extract<ManagedFieldDescriptor, { readonly type: Type }>;
}

function itemFieldOf(collectionId: string, fieldId: string): ManagedCollectionItemField {
  const collection = site.contract.collections.find((candidate) => candidate.id === collectionId);
  if (collection === undefined) return refuse(collectionId + " is not a collection in the contract");
  const field = collection.itemFields.find((candidate) => candidate.id === fieldId);
  if (field === undefined) return refuse(fieldId + " is not a field of " + collectionId);
  return field;
}

function itemFieldOfType<Type extends ManagedCollectionItemField["type"]>(
  collectionId: string,
  fieldId: string,
  type: Type,
): Extract<ManagedCollectionItemField, { readonly type: Type }> {
  const field = itemFieldOf(collectionId, fieldId);
  if (field.type !== type) return refuse(fieldId + " is a " + field.type + " field, not " + type);
  return field as Extract<ManagedCollectionItemField, { readonly type: Type }>;
}

// ---------------------------------------------------------------------------
// Order
// ---------------------------------------------------------------------------

/**
 * The contract's own comparison (arraysEqual in content-semantics-collections)
 * is not exported, so this is its restatement: same length, same id at every
 * position. It only decides whether to refuse orders the contract refuses.
 */
function sameOrder(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((itemId, index) => right[index] === itemId);
}

/**
 * A collection's item ids in the CUSTOMER's order: the orderedItemIds of the
 * collection fields that order it.
 *
 * The contract lets several fields order one collection as long as every one
 * holds the same order (CONTENT_COLLECTION_ORDER_CONFLICT otherwise), and it
 * lets a collection have no ordering field only while it has no items, so the
 * source order -- then empty -- is the answer there. Neither case throws.
 *
 * A template that renders in this order must join each row to its item by id,
 * with managedItemById, never by position: position here and position in the
 * source array differ once the customer reorders (see sourceItemIdsOf).
 */
export function managedOrder(collectionId: string): readonly string[] {
  const known = sourceItemIds(collectionId);
  const orders = [...fieldDescriptors.values()]
    .filter((field) => field.type === "collection" && field.collectionId === collectionId)
    .map((field) => readTyped(field.id, ownerOf(field.id), "collection").orderedItemIds);
  const [order = known] = orders;
  if (!orders.every((other) => sameOrder(other, order))) {
    return refuse(collectionId + " has conflicting orders, which the contract refuses");
  }
  return order;
}

export interface ManagedItemById extends ManagedItem {
  readonly itemId: string;
  link(fieldId: string): ManagedLink;
  image(fieldId: string): ManagedImage;
  richText(fieldId: string): ManagedRichTextBlocks;
}

/**
 * One item of a collection, by its stable id -- the join a template rendering
 * managedOrder needs. An id the collection's source does not list throws: every
 * id managedOrder returns is one it lists, so only calling code can pass one.
 */
export function managedItemById(collectionId: string, itemId: string): ManagedItemById {
  if (!sourceItemIds(collectionId).includes(itemId)) {
    return refuse(itemId + " is not an item of " + collectionId);
  }
  const owner: Owner = {
    kind: "collection_item",
    collectionId: collectionId as never,
    itemId: itemId as never,
  };
  const attributes = (fieldId: string): ManagedSiteFieldAttributesV1 => {
    itemFieldOf(collectionId, fieldId);
    return managedSiteFieldAttributesV1(fieldId as never, itemId as never);
  };
  return {
    itemId,
    value(fieldId: string): string {
      const { type } = itemFieldOf(collectionId, fieldId);
      if (type !== "plain_text" && type !== "heading_text") {
        return refuse(fieldId + " is a " + type + " field, not text");
      }
      return textOf(fieldId, { owner, type });
    },
    attributes,
    link(fieldId: string): ManagedLink {
      itemFieldOfType(collectionId, fieldId, "link");
      return {
        ...resolveManagedLink(readTyped(fieldId, owner, "link")),
        attributes: attributes(fieldId),
      };
    },
    image(fieldId: string): ManagedImage {
      const field = itemFieldOfType(collectionId, fieldId, "image");
      return {
        ...resolveManagedImage(field.assetSlotId, readTyped(fieldId, owner, "image")),
        attributes: attributes(fieldId),
      };
    },
    richText(fieldId: string): ManagedRichTextBlocks {
      itemFieldOfType(collectionId, fieldId, "rich_text");
      return {
        value: renderManagedRichText(readTyped(fieldId, owner, "rich_text")),
        attributes: attributes(fieldId),
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

/** What an anchor needs. target and rel are undefined for a same-window link. */
export interface ManagedLinkProps {
  readonly href: string;
  readonly label: string;
  readonly target: "_blank" | undefined;
  readonly rel: "noopener noreferrer" | undefined;
}

export interface ManagedLink extends ManagedLinkProps {
  readonly attributes: ManagedSiteFieldAttributesV1;
}

type ManagedLinkValue = ContentValueOf<"link">;

/**
 * Stands in for the field a bare link value arrives without, so the value can
 * go through the contract's OWN content-value parser: the label, destination
 * and target rules applied here are the contract's, not a restatement. Any
 * syntactically valid field id serves; the parser does not look it up.
 */
const LINK_PROBE_FIELD_ID = "field_00000000000000000000000000";

/**
 * Runs a contract-package parser, so a refusal is reported the way every other
 * reader's is. The parser decides; this only relabels its answer.
 */
function acceptedByContract<Value>(what: string, parse: () => Value): Value {
  try {
    return parse();
  } catch (error) {
    return refuse(what + " is not one the contract accepts: " + (error instanceof Error ? error.message : String(error)));
  }
}

function parseLinkValue(value: unknown): ManagedLinkValue {
  const parsed = acceptedByContract("a link value", () =>
    parseManagedSiteContentValue({
      fieldId: LINK_PROBE_FIELD_ID,
      // Not an owner: the parser never looks a value up, only checks its shape.
      owner: { kind: "site" },
      type: "link",
      value,
    }),
  );
  return (parsed as Extract<ManagedSiteContentValue, { readonly type: "link" }>).value;
}

/**
 * Anchor props for a destination and target, through the module's one link
 * builder, managedRichTextLink: the contract's managedRichTextLinkAttributesV1
 * (with pagePath, which refuses a page with no single static path -- one the
 * contract, since 0.13.0, never lets a value name) plus rel for a new window.
 * Link fields, whole documents and formatted blocks all go through it, so they
 * cannot disagree on an href or a rel.
 */
function anchorOf(destination: ManagedLinkDestination, target: ManagedLinkTarget): Omit<ManagedLinkProps, "label"> {
  const { href, target: window, rel } = managedRichTextLink({ type: "link", destination, target });
  return { href, target: window, rel };
}

/**
 * A link VALUE -- { destination, label, target } -- as anchor props, judged by
 * the contract's own parser. Exported so a value that reached a component some
 * other way resolves by the same rule.
 */
export function resolveManagedLink(value: unknown): ManagedLinkProps {
  const link = parseLinkValue(value);
  return { label: link.label, ...anchorOf(link.destination, link.target) };
}

/** A page- or site-owned link field, resolved. <a {...link.attributes} href={link.href} ...>. */
export function managedLink(fieldId: string): ManagedLink {
  fieldOfType(fieldId, "link");
  return {
    ...resolveManagedLink(readTyped(fieldId, ownerOf(fieldId), "link")),
    attributes: managedSiteFieldAttributesV1(fieldId as never),
  };
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

export interface ManagedImageProps {
  /** Root-relative: public/managed-site-cms/a.webp is served at /managed-site-cms/a.webp. */
  readonly src: string;
  /** The slot's fixed text for a fixed_alt slot, "" for a decorative one. */
  readonly alt: string;
  readonly width: number;
  readonly height: number;
  /** Fractions of the width and height, for object-position; null when unset. */
  readonly focalPoint: { readonly x: number; readonly y: number } | null;
  /**
   * The part of the image to show, as fractions of it; null for the whole
   * image (no crop, or a full-frame one). Render it with managedImageCrop.
   */
  readonly crop: ManagedImageCrop | null;
}

export interface ManagedImageCrop {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface ManagedImage extends ManagedImageProps {
  readonly attributes: ManagedSiteFieldAttributesV1;
}

/**
 * Where a repository path is served: under the contract's served root,
 * public/, which Next.js serves from the site root, at the root without it.
 * Since contract 0.12.0 the contract accepts an image only there
 * (isManagedServedAssetPath), so a path outside it is refused rather than
 * rendered as a URL nothing serves. It cannot be reached with a value the
 * contract accepts. A repository path has no %, ?, # or lone surrogate, so
 * encoding each segment cannot throw.
 */
function servedPath(path: string): string {
  if (!isManagedServedAssetPath(path)) {
    return refuse(path + " is not served: an image must be under " + MANAGED_SERVED_ASSET_ROOT);
  }
  return "/" + path.slice(MANAGED_SERVED_ASSET_ROOT.length).split("/").map(encodeURIComponent).join("/");
}

/**
 * An image VALUE in the named slot, as img props, read from what the
 * contract's own validateManagedImageValue returns -- the slot policy Site
 * Guard runs -- never from the raw input. The alt text is then
 * resolveManagedImageAltText's, which owns the fixed_alt and decorative answers.
 */
export function resolveManagedImage(assetSlotId: string, value: unknown): ManagedImageProps {
  const slot = site.contract.assets.find((candidate) => candidate.id === assetSlotId);
  if (slot === undefined) return refuse(assetSlotId + " is not an asset slot in the contract");
  const image = acceptedByContract("an image value", () => validateManagedImageValue(slot, value));
  return {
    src: servedPath(image.path),
    alt: resolveManagedImageAltText(slot, image),
    width: image.width,
    height: image.height,
    focalPoint: image.focalPoint === null ? null : { x: image.focalPoint.x, y: image.focalPoint.y },
    crop: shownCrop(image.crop),
  };
}

function shownCrop(crop: ManagedImageValue["crop"]): ManagedImageCrop | null {
  if (crop === null) return null;
  const whole = crop.x === 0 && crop.y === 0 && crop.width === 1 && crop.height === 1;
  return whole ? null : { x: crop.x, y: crop.y, width: crop.width, height: crop.height };
}

/** A percentage, short enough to read and exact to a hundred-thousandth. */
function percent(value: number): string {
  return String(Number(value.toFixed(5))) + "%";
}

/**
 * Inline styles that show only a crop of an image: a frame with the crop's
 * aspect ratio that clips, and the whole image inside it, scaled so the crop
 * fills the frame and shifted so the crop's corner sits at the frame's. Put
 * frame on a wrapper (give it a width) and image on the <img>:
 *
 *   <span style={crop.frame}><img style={crop.image} src=... alt=... /></span>
 *
 * Use a plain <img>, or next/image WITHOUT fill: fill positions the image
 * absolutely to cover its parent, which fights the image style's own size and
 * offset, and the crop is lost.
 *
 * Percentages, so it holds at any rendered size. A wrapper rather than CSS
 * object-view-box, which only Chromium supports; a crop the customer saved has
 * to show in every browser. Null for a whole image, which renders as before.
 * The contract accepts crops (validateManagedImageValue) and megaseo-web's CMS
 * stores a crop edit of an image already set, so a crop is never ignored.
 */
export function managedImageCrop(image: Pick<ManagedImageProps, "width" | "height" | "crop">): {
  readonly frame: Readonly<Record<string, string>>;
  readonly image: Readonly<Record<string, string>>;
} | null {
  const { crop } = image;
  if (crop === null) return null;
  // Since contract 0.13.0 a crop covers at least one pixel on each axis
  // (crop.width >= 1 / width), so the zoom is at most 100 * width. A crop that
  // somehow is not -- a value that bypassed the contract -- is refused rather
  // than rendered as Infinity% or NaN%.
  const numbers = [
    image.width * crop.width,
    image.height * crop.height,
    100 / crop.width,
    100 / crop.height,
    (-100 * crop.x) / crop.width,
    (-100 * crop.y) / crop.height,
  ];
  if (!numbers.every(Number.isFinite) || crop.width < 1 / image.width || crop.height < 1 / image.height) {
    return refuse("a crop smaller than one pixel of its image cannot be rendered");
  }
  return {
    frame: {
      position: "relative",
      display: "block",
      overflow: "hidden",
      aspectRatio: String(image.width * crop.width) + " / " + String(image.height * crop.height),
    },
    image: {
      position: "absolute",
      maxWidth: "none",
      width: percent(100 / crop.width),
      height: percent(100 / crop.height),
      left: percent((-100 * crop.x) / crop.width),
      top: percent((-100 * crop.y) / crop.height),
    },
  };
}

/** A page- or site-owned image field. <img {...image.attributes} src={image.src} alt={image.alt} ...>. */
export function managedImage(fieldId: string): ManagedImage {
  const field = fieldOfType(fieldId, "image");
  return {
    ...resolveManagedImage(field.assetSlotId, readTyped(fieldId, ownerOf(fieldId), "image")),
    attributes: managedSiteFieldAttributesV1(fieldId as never),
  };
}

// ---------------------------------------------------------------------------
// Rich text
// ---------------------------------------------------------------------------

export interface ManagedRichTextBlocks {
  /** The rendered blocks, with no wrapper: put attributes on the element that holds them. */
  readonly value: ReactNode;
  readonly attributes: ManagedSiteFieldAttributesV1;
}

type RichTextBlock = ManagedRichTextDocument["content"][number];
type RichTextParagraph = Extract<RichTextBlock, { readonly type: "paragraph" }>;
type RichTextListItem = Extract<RichTextBlock, { readonly type: "bullet_list" }>["content"][number];
type RichTextHeadingLevel = Extract<RichTextBlock, { readonly type: "heading" }>["attrs"]["level"];

/**
 * Total over the levels the contract admits, so a level it adds is a compile
 * error here rather than a heading drawn at the wrong rank.
 */
const HEADING_TAG = { 1: "h1", 2: "h2", 3: "h3" } as const satisfies Record<RichTextHeadingLevel, string>;

/**
 * THE rich-text renderer is the formatted-block one above: renderSpans over
 * the contract's groupManagedRichTextInlines, each mark through
 * managedRichTextMarkAttributesV1 and each link through managedRichTextLink,
 * outermost mark first. A whole document renders each of its paragraphs and
 * headings through it with no templates, so every mark is that renderer's own
 * fallback element and the two readers render identical markup.
 */
const PLAIN_MARKS: ManagedRichTextTemplates = {};

function renderInlines(content: RichTextParagraph["content"]): ReactNode {
  return renderSpans(groupManagedRichTextInlines(content), PLAIN_MARKS);
}

function renderParagraph(node: RichTextParagraph): ReactNode {
  return createElement("p", null, renderInlines(node.content));
}

function renderListItem(node: RichTextListItem): ReactNode {
  return createElement("li", null, ...node.content.map(renderParagraph));
}

/** Total over the block union the contract parsed: a new block kind fails to compile here. */
function renderBlock(node: RichTextBlock): ReactNode {
  switch (node.type) {
    case "paragraph":
      return renderParagraph(node);
    case "heading":
      return createElement(HEADING_TAG[node.attrs.level], null, renderInlines(node.content));
    case "bullet_list":
      return createElement("ul", null, ...node.content.map(renderListItem));
    case "ordered_list":
      return createElement("ol", null, ...node.content.map(renderListItem));
    case "blockquote":
      return createElement("blockquote", null, ...node.content.map(renderParagraph));
  }
}

/**
 * A rich-text document as React elements, once the contract's own parser
 * (parseManagedRichTextDocument, the one Site Guard runs) has accepted it:
 * paragraph, heading 1 to 3, bullet and ordered lists, blockquote; bold,
 * italic and link marks; hard breaks. A document it refuses throws.
 */
export function renderManagedRichText(document: unknown): ReactNode {
  const parsed = acceptedByContract("a rich-text document", () => parseManagedRichTextDocument(document));
  return createElement(Fragment, null, ...parsed.content.map(renderBlock));
}

/**
 * A page- or site-owned rich-text field as a whole document, every block in
 * its plain element: <div {...body.attributes}>{body.value}</div>. The
 * formatted-block reader above, managedRichText(fieldId, templates), is the
 * other shape: ONE paragraph or heading rendered through the site's own
 * elements, which is what the rewrite emits for a formatted block.
 */
export function managedRichTextBlocks(fieldId: string): ManagedRichTextBlocks {
  fieldOfType(fieldId, "rich_text");
  return {
    value: renderManagedRichText(readTyped(fieldId, ownerOf(fieldId), "rich_text")),
    attributes: managedSiteFieldAttributesV1(fieldId as never),
  };
}

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

const protectedFieldIds = new Set<string>(
  site.contract.internalSeo.protectedFields.map((field) => field.id),
);

/**
 * The customer's search text for one metadata slot, or null for "use the
 * page default": when the slot names a protected field (its literal is the
 * default), or when the customer left the field blank. Which field a slot may
 * name is the contract's rule (CONTRACT_SEO_FIELD_POLICY); a slot naming any
 * other is a contract it refuses.
 */
function editableSeoText(
  pageId: string,
  fieldId: string | null,
  semantic: "seo_title" | "seo_description",
): string | null {
  if (fieldId === null || protectedFieldIds.has(fieldId)) return null;
  const field = fieldOfType(fieldId, "plain_text");
  const owner = ownerOf(fieldId);
  if (field.semantic !== semantic || owner.kind !== "page" || owner.pageId !== pageId) {
    return refuse(fieldId + " is not " + pageId + "'s own " + semantic + " field");
  }
  const value = readTyped(fieldId, owner, "plain_text");
  return isBlank(value) ? null : value;
}

/**
 * Blank as the contract states it. It exports no predicate for "the site
 * falls back"; its one rule about blank text, an informative image's alt
 * (values.ts, hasValidAlt), is trim().length === 0, and this is that rule.
 * The field's own rule already refuses every control and bidi character.
 */
function isBlank(value: string): boolean {
  return value.trim().length === 0;
}

type PageSeo = (typeof site.contract.internalSeo.pages)[number];

/** What the customer's edits contribute to one share card. */
interface CardPatch {
  readonly title?: string;
  readonly description?: string;
  readonly images?: { url: string; width: number; height: number; alt: string }[];
}

function statesKey(card: unknown, key: "title" | "description"): boolean {
  return typeof card === "object" && card !== null && (card as Readonly<Record<string, unknown>>)[key] !== undefined;
}

/**
 * A share card's text for one slot. A social slot naming a field is that
 * field's text. A NULL social slot has no text of its own, so a card that
 * already states the key follows the page's edited text instead of keeping a
 * hand-written copy of what the customer has since changed; a card that never
 * stated it gains nothing, so the page's tag set stays what the site wrote.
 */
function cardText(
  pageId: string,
  slotFieldId: string | null,
  edited: string | null,
  semantic: "seo_title" | "seo_description",
  card: unknown,
  key: "title" | "description",
): string | null {
  if (slotFieldId !== null) return editableSeoText(pageId, slotFieldId, semantic);
  return edited !== null && statesKey(card, key) ? edited : null;
}

/**
 * The origin of the page's canonical URL. Canonical is protected and always an
 * absolute https URL (the contract's slot rule), so it is where the site says
 * it lives: a share image is fetched by other sites' crawlers and needs one.
 */
function canonicalOrigin(pageId: string, seo: PageSeo): string {
  const fieldId = seo.metadata.canonical;
  const field = site.contract.internalSeo.protectedFields.find((candidate) => candidate.id === fieldId);
  if (field === undefined) return refuse(pageId + "'s canonical is not a protected field");
  const canonical = site.readValue({ fieldId: fieldId as never, owner: ownerOf(fieldId), type: "internal_protected" });
  if (canonical.valueType !== "url" || typeof canonical.value !== "string") {
    return refuse(pageId + "'s canonical is not a URL");
  }
  return new URL(canonical.value).origin;
}

function shareImages(pageId: string, seo: PageSeo): CardPatch["images"] | null {
  const { imageFieldId } = seo.metadata.social;
  if (imageFieldId === undefined) return null;
  const image = managedImage(imageFieldId);
  const url = canonicalOrigin(pageId, seo) + image.src;
  return [{ url, width: image.width, height: image.height, alt: image.alt }];
}

function cardPatch(
  pageId: string,
  seo: PageSeo,
  edited: { readonly title: string | null; readonly description: string | null },
  images: CardPatch["images"] | null,
  card: unknown,
): CardPatch {
  const { social } = seo.metadata;
  const title = cardText(pageId, social.title, edited.title, "seo_title", card, "title");
  const description = cardText(pageId, social.description, edited.description, "seo_description", card, "description");
  return {
    ...(title === null ? {} : { title }),
    ...(description === null ? {} : { description }),
    ...(images === null ? {} : { images }),
  };
}

function isEditableSlot(fieldId: string | null | undefined): boolean {
  return fieldId !== null && fieldId !== undefined && !protectedFieldIds.has(fieldId);
}

/**
 * A page whose contract lets the customer edit its share card -- a share image,
 * or a social title or description naming an editable field -- must be given
 * the openGraph card the edit lands on. Without one, every such edit would be
 * dropped: the publish succeeds and nothing visible changes. The metadata a
 * page passes here is CODE, so this fires on the first build of that page,
 * whatever the content says, never as the result of a customer's publish.
 * (The contract has no twitter-only slots; twitter follows openGraph when the
 * page states one.)
 */
function requireCardForEditableSocial(pageId: string, seo: PageSeo, fallback: Metadata): void {
  const { social } = seo.metadata;
  const editable =
    social.imageFieldId !== undefined || isEditableSlot(social.title) || isEditableSlot(social.description);
  if (editable && !fallback.openGraph) {
    refuse(
      pageId + "'s share card is customer-editable, but the metadata passed to managedMetadata has no " +
        "openGraph for the edit to land on. Pass the page's effective metadata, including the openGraph " +
        "it inherits from its layout.",
    );
  }
}

/**
 * The edited title in the shape fallback's title had. An absolute title opts
 * out of the layout's template ("%s | Brand"), and a plain string would opt
 * back in, suffixing the customer's text where the site chose no suffix; a
 * default keeps the template it declares for child segments.
 */
function titleShaped(fallback: Metadata["title"], edited: string): Metadata["title"] {
  if (typeof fallback !== "object" || fallback === null) return edited;
  if ("absolute" in fallback) return { ...fallback, absolute: edited };
  return { ...fallback, default: edited };
}

/**
 * A page's metadata: fallback -- the page's literal metadata, as the site
 * wrote it -- with the title, description and share image the customer set
 * laid over it, on the page and on its share cards (openGraph, and twitter
 * when fallback has one). The share image is absolute, on the canonical's
 * origin. Canonical and indexing are read only for that origin: whatever
 * fallback says about them is what renders. A generated page has no editable
 * metadata in the contract, so it is fallback.
 */
export function managedMetadata(pageId: string, fallback: Metadata): Metadata {
  const seo = site.contract.internalSeo.pages.find((candidate) => candidate.pageId === pageId);
  if (seo === undefined) {
    if (site.contract.pages.some((page) => page.id === pageId)) return fallback;
    return refuse(pageId + " is not a page in the contract");
  }
  requireCardForEditableSocial(pageId, seo, fallback);
  const edited = {
    title: editableSeoText(pageId, seo.metadata.title, "seo_title"),
    description: editableSeoText(pageId, seo.metadata.description, "seo_description"),
  };
  const images = shareImages(pageId, seo);
  // Next merges a page's metadata into its layouts' SHALLOWLY: a page-level
  // openGraph replaces the layout's whole card. So a card is patched only when
  // fallback states it, and fallback must be the page's effective metadata --
  // including any openGraph or twitter it inherits -- for a share image or a
  // social text to reach a card.
  const openGraph = fallback.openGraph ? cardPatch(pageId, seo, edited, images, fallback.openGraph) : {};
  const twitter = fallback.twitter ? cardPatch(pageId, seo, edited, images, fallback.twitter) : {};
  return {
    ...fallback,
    ...(edited.title === null ? {} : { title: titleShaped(fallback.title, edited.title) }),
    ...(edited.description === null ? {} : { description: edited.description }),
    ...(Object.keys(openGraph).length > 0 ? { openGraph: { ...fallback.openGraph, ...openGraph } } : {}),
    ...(Object.keys(twitter).length > 0 ? { twitter: { ...fallback.twitter, ...twitter } } : {}),
  };
}
`;
