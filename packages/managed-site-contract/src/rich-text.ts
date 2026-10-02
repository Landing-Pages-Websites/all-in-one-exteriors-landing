import * as z from "zod";

import { canonicalizeJson } from "./canonical.js";
import type { DeepReadonly } from "./deep-readonly.js";
import { ManagedSiteContractError } from "./errors.js";
import { parseJsonValue } from "./json.js";
import { parseParsedSchemaInput } from "./schema-input.js";
import {
  managedLinkDestinationSchema,
  managedLinkTargetSchema,
} from "./values.js";

export const MAX_RICH_TEXT_DEPTH = 8;
export const MAX_RICH_TEXT_NODES = 2_000;
export const MAX_RICH_TEXT_BYTES = 131_072;
/**
 * The largest cap a field may name for its hard breaks. A cap is for a block
 * drawn on a fixed handful of lines (a hero heading on three), so it never
 * needs to be large; a field that wants no cap names none.
 */
export const MANAGED_RICH_TEXT_MAX_HARD_BREAKS = 16;
const MAX_RICH_TEXT_JSON_DEPTH = MAX_RICH_TEXT_DEPTH * 2;
const MAX_RICH_TEXT_JSON_NODES = MAX_RICH_TEXT_NODES * 10;

/**
 * A document names its children `content` and its root `doc`, and carries marks
 * as objects rather than strings, because this is the one shape an editor can
 * round-trip without translating. The editors in this family serialise to
 * `type`/`content`/`marks` and cannot be told to call the child array anything
 * else, so any other spelling puts a conversion step between every keystroke and
 * the stored value, which is where a read and a write start to disagree.
 */
const managedRichTextBoldMarkSchema = z.strictObject({
  type: z.literal("bold"),
});

const managedRichTextItalicMarkSchema = z.strictObject({
  type: z.literal("italic"),
});

/**
 * A link is a mark, not a node wrapping text, so it composes with bold and
 * italic instead of nesting against them.
 *
 * It carries the same destination union a `link` field carries, so prose links
 * and link fields cannot drift apart on what a destination is, and an internal
 * link names a `pageId` rather than a path: a path breaks the moment a route is
 * renamed, and a stable id does not.
 */
const managedRichTextLinkMarkSchema = z.strictObject({
  type: z.literal("link"),
  destination: managedLinkDestinationSchema,
  target: managedLinkTargetSchema,
});

export const managedRichTextMarkSchema = z.discriminatedUnion("type", [
  managedRichTextBoldMarkSchema,
  managedRichTextItalicMarkSchema,
  managedRichTextLinkMarkSchema,
]);

/**
 * The mark kinds a field's constraints may name. Constraints narrow by kind
 * while a document carries whole mark objects, so these are two schemas rather
 * than one doing both jobs, and a constraint list stays the plain strings it has
 * always been.
 *
 * `link` is absent deliberately. Prose links are governed by `allowLinks` and
 * its companions, exactly as they were when a link was a node rather than a
 * mark, so becoming a mark does not quietly introduce a second switch that also
 * has to be set.
 */
export const managedRichTextMarkKindSchema = z.enum(["bold", "italic"]);

/**
 * Unmarked text omits `marks` entirely rather than carrying an empty array, so
 * one run of prose has exactly one spelling. The stored blob is hashed, and two
 * spellings of the same text would hash differently while meaning the same
 * thing. It is also what the writer accepts and what this family of editors
 * serialises.
 *
 * One of each mark at most: two of the same kind is not a distinguishable state.
 */
const managedRichTextTextSchema = z
  .strictObject({
    type: z.literal("text"),
    // No control character, newline included: a line break is only ever the
    // `hard_break` node, so a value has one spelling for it, and the CMS writer
    // (`[[:cntrl:]]`) and reader (`\p{Cc}`) refuse the same characters.
    text: z.string().regex(/^\P{Cc}*$/u),
    marks: z.array(managedRichTextMarkSchema).min(1).max(3).optional(),
  })
  .refine((node) => {
    const kinds = (node.marks ?? []).map((mark) => mark.type);
    return new Set(kinds).size === kinds.length;
  });

/**
 * A line break inside one block. It is structure, not text: it carries no
 * attrs, no marks and no other key, so there is one spelling of it, and where
 * it renders is decided by the text either side (see
 * `groupManagedRichTextInlines`). A field admits it only by opting in with
 * `allowHardBreaks`.
 */
const managedRichTextHardBreakSchema = z.strictObject({
  type: z.literal("hard_break"),
});

/**
 * The inline level: text, and the hard breaks between runs of it. Links are
 * marks on text, not nodes.
 */
export const managedRichTextInlineSchema = z.discriminatedUnion("type", [
  managedRichTextTextSchema,
  managedRichTextHardBreakSchema,
]);

/**
 * A block's inline content. A break separates two lines of text, so it sits
 * between two NON-EMPTY text nodes: never leading or ending its block, never
 * beside another break, and never beside empty text, which would be the same
 * empty line spelled another way. An empty line is spacing a site's CSS owns.
 */
function holdsText(node: z.infer<typeof managedRichTextInlineSchema> | undefined): boolean {
  return node?.type === "text" && node.text !== "";
}

const managedRichTextInlineContentSchema = z
  .array(managedRichTextInlineSchema)
  .min(1)
  .refine(
    (content) =>
      content.every(
        (node, index) =>
          node.type !== "hard_break" || (holdsText(content[index - 1]) && holdsText(content[index + 1])),
      ),
    { message: "A hard break must sit between two non-empty text nodes" },
  );

const managedRichTextParagraphSchema = z.strictObject({
  type: z.literal("paragraph"),
  content: managedRichTextInlineContentSchema,
});

const managedRichTextListItemSchema = z.strictObject({
  type: z.literal("list_item"),
  content: z.array(managedRichTextParagraphSchema).min(1),
});

const managedRichTextBulletListSchema = z.strictObject({
  type: z.literal("bullet_list"),
  content: z.array(managedRichTextListItemSchema).min(1),
});

const managedRichTextOrderedListSchema = z.strictObject({
  type: z.literal("ordered_list"),
  content: z.array(managedRichTextListItemSchema).min(1),
});

/**
 * Headings, levels 1 to 3. Level 1 is admitted because a converted site's page
 * title is often one formatted `h1` (a hero heading with a styled span), and
 * that heading is the field's one block; anything below 3 is structure a body
 * of prose does not need. A field that does not opt into headings through
 * `allowedBlocks` still gains nothing, but one that does (a prose body without
 * `maxBlocks`) can now hold an `h1` too: its renderer owns the page's outline.
 * The level lives in `attrs` because that is where
 * this family of editors serialises a node's attributes, so the stored value is
 * the one an editor round-trips.
 *
 * A heading holds the same text a paragraph does, links included: a text node
 * is one node wherever it sits, so the marks and link policy that govern it
 * cannot depend on its parent, and a link here is judged exactly as one in a
 * paragraph is.
 */
export const managedRichTextHeadingLevelSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);

const managedRichTextHeadingSchema = z.strictObject({
  type: z.literal("heading"),
  attrs: z.strictObject({
    level: managedRichTextHeadingLevelSchema,
  }),
  content: managedRichTextInlineContentSchema,
});

export type ManagedRichTextHeadingLevel = z.infer<typeof managedRichTextHeadingLevelSchema>;

/**
 * The heading levels a document may carry, read from the schema so a converter
 * deciding whether an element can become a heading block asks the same question
 * the parser answers.
 */
export const MANAGED_RICH_TEXT_HEADING_LEVELS: readonly ManagedRichTextHeadingLevel[] =
  Object.freeze(managedRichTextHeadingLevelSchema.options.map((option) => option.value));

/** A quotation: paragraphs and nothing else, so it cannot nest or hold a list. */
const managedRichTextBlockquoteSchema = z.strictObject({
  type: z.literal("blockquote"),
  content: z.array(managedRichTextParagraphSchema).min(1),
});

export const managedRichTextBlockSchema = z.discriminatedUnion("type", [
  managedRichTextParagraphSchema,
  managedRichTextHeadingSchema,
  managedRichTextBulletListSchema,
  managedRichTextOrderedListSchema,
  managedRichTextBlockquoteSchema,
]);

/**
 * The top-level block kinds a document may carry, derived from the schema so a
 * field's `allowedBlocks` can name exactly what a document can hold.
 */
type ManagedRichTextBlockKind = z.infer<typeof managedRichTextBlockSchema>["type"];

export const MANAGED_RICH_TEXT_BLOCK_KINDS = managedRichTextBlockSchema.options.map(
  (option) => option.shape.type.value,
) as [ManagedRichTextBlockKind, ...ManagedRichTextBlockKind[]];

export const managedRichTextDocumentSchema = z.strictObject({
  type: z.literal("doc"),
  content: z.array(managedRichTextBlockSchema).min(1),
});

export type ManagedRichTextMark = DeepReadonly<
  z.infer<typeof managedRichTextMarkSchema>
>;
export type ManagedRichTextMarkKind = z.infer<
  typeof managedRichTextMarkKindSchema
>;
export type ManagedRichTextInline = DeepReadonly<
  z.infer<typeof managedRichTextInlineSchema>
>;
export type ManagedRichTextText = Extract<ManagedRichTextInline, { type: "text" }>;
export type ManagedRichTextHardBreak = Extract<ManagedRichTextInline, { type: "hard_break" }>;
export type ManagedRichTextBlock = DeepReadonly<
  z.infer<typeof managedRichTextBlockSchema>
>;
export type ManagedRichTextDocument = DeepReadonly<
  z.infer<typeof managedRichTextDocumentSchema>
>;

type RichTextParagraph = Extract<ManagedRichTextBlock, { type: "paragraph" }>;
type RichTextListItem = Extract<
  ManagedRichTextBlock,
  { type: "bullet_list" }
>["content"][number];
type RichTextText = ManagedRichTextText;

export interface ManagedRichTextSummary {
  /** Text only: a hard break is a node, not a character. */
  readonly characters: number;
  readonly nodes: number;
  readonly hardBreaks: number;
  /** Every inline node in document order, hard breaks included. */
  readonly inlines: readonly ManagedRichTextInline[];
  readonly blocks: readonly ManagedRichTextBlock[];
  readonly textNodes: readonly RichTextText[];
}

function countParagraphNodes(paragraph: RichTextParagraph): number {
  return 1 + paragraph.content.length;
}

function countParagraphsNodes(paragraphs: readonly RichTextParagraph[]): number {
  return paragraphs.reduce((sum, paragraph) => sum + countParagraphNodes(paragraph), 0);
}

function countListItemNodes(item: RichTextListItem): number {
  return 1 + countParagraphsNodes(item.content);
}

/**
 * Exhaustive over the block union, so a new block kind is a compile error here
 * rather than a block whose nodes the size limit silently never counts.
 */
function countBlockNodes(block: ManagedRichTextBlock): number {
  switch (block.type) {
    case "paragraph":
    case "heading":
      return 1 + block.content.length;
    case "blockquote":
      return 1 + countParagraphsNodes(block.content);
    case "bullet_list":
    case "ordered_list":
      return 1 + block.content.reduce((sum, item) => sum + countListItemNodes(item), 0);
  }
}

function countDocumentNodes(document: ManagedRichTextDocument): number {
  return 1 + document.content.reduce((sum, block) => sum + countBlockNodes(block), 0);
}

/**
 * Every inline node in a block, in document order. Exhaustive for the same
 * reason as {@link countBlockNodes}: text this skipped would escape the
 * character limit, the mark allowlist and the link policy, and a break it
 * skipped would escape the field's hard-break policy, all of which read it.
 */
function collectInlines(block: ManagedRichTextBlock): readonly ManagedRichTextInline[] {
  switch (block.type) {
    case "paragraph":
    case "heading":
      return block.content;
    case "blockquote":
      return block.content.flatMap((paragraph) => paragraph.content);
    case "bullet_list":
    case "ordered_list":
      return block.content.flatMap((item) =>
        item.content.flatMap((paragraph) => paragraph.content),
      );
  }
}

export function summarizeManagedRichText(
  document: ManagedRichTextDocument,
): ManagedRichTextSummary {
  const blocks = document.content;
  const inlines = blocks.flatMap(collectInlines);
  const textNodes = inlines.filter((node): node is RichTextText => node.type === "text");
  return {
    characters: textNodes.reduce((sum, node) => sum + node.text.length, 0),
    nodes: countDocumentNodes(document),
    hardBreaks: inlines.length - textNodes.length,
    inlines,
    blocks,
    textNodes,
  };
}

export function parseManagedRichTextDocument(
  input: unknown,
): ManagedRichTextDocument {
  const parsed = parseJsonValue(input, {
    maxDepth: MAX_RICH_TEXT_JSON_DEPTH,
    maxNodes: MAX_RICH_TEXT_JSON_NODES,
  });
  if (Buffer.byteLength(canonicalizeJson(parsed), "utf8") > MAX_RICH_TEXT_BYTES) {
    throw new ManagedSiteContractError(
      "RICH_TEXT_MAX_BYTES",
      "Rich text exceeds the UTF-8 byte limit",
    );
  }
  const document = parseParsedSchemaInput(managedRichTextDocumentSchema, parsed);
  if (summarizeManagedRichText(document).nodes > MAX_RICH_TEXT_NODES) {
    throw new ManagedSiteContractError(
      "RICH_TEXT_MAX_NODES",
      "Rich text exceeds the semantic node limit",
    );
  }
  return document;
}
