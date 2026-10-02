import ts from "typescript";

import {
  canonicalizeJson,
  groupManagedRichTextInlines,
  MANAGED_RICH_TEXT_BREAK_ATTRIBUTE,
  MANAGED_RICH_TEXT_MARK_ATTRIBUTE,
  managedRichTextLinkAttributesV1,
  parseManagedRichTextDocument,
  type ManagedRichTextInline,
  type ManagedRichTextMark,
  type ManagedRichTextSpan,
} from "@landing-pages-websites/managed-site-contract";

import { offSiteDestination, readDestination } from "./destinations.js";
import {
  attributeExpression,
  childrenOf,
  decodeJsxEntities,
  findAttribute,
  isComponentName,
  isElementChild,
  isWalkedElement,
  jsxExpressionStringValue,
  literalAttributeValue,
  namedAttributes,
  tagNameOf,
  type JsxElementNode,
} from "./jsx-facts.js";
import { resolvedStringValueOf, type ModuleConstants } from "./literals.js";

/**
 * Reading one visual text block -- a heading, a paragraph, a button label --
 * as ONE rich-text value.
 *
 * The invariant: a block whose inline children all map to a mark becomes one
 * field, and a block with anything that does not map is refused whole. It is
 * never split into one field per text run (which is what made customers see
 * fragments of one sentence as separate fields), and a mark is never guessed.
 *
 * "Maps" is decided twice, and the second decision is the one that counts. The
 * first classifies each element by its tag and literal classes. The second
 * renders the document back through the site's own elements, exactly as the
 * rewritten site will, and compares that to the source: anything the document
 * cannot say -- two adjacent runs of one mark, a mark nested inside itself, one
 * mark written two ways, an empty element, a link target the contract has no
 * word for -- renders differently, and is refused for it. Refusing by
 * comparison rather than by a list of known-bad shapes means the next shape
 * nobody thought of is refused too.
 */

type MarkKind = ManagedRichTextMark["type"];
type LinkMark = Extract<ManagedRichTextMark, { type: "link" }>;

/**
 * The site's own element for one mark, as JSX text around its children.
 *
 * `open` already carries the mark annotation, and a link's `open` reads its
 * `href` and `target` from a `link` binding the rewritten code supplies.
 */
export interface MarkTemplate {
  readonly open: string;
  readonly close: string;
}

/**
 * The site's elements for a block's marks, and for its line break. A break's
 * `open` is the whole self-closing element (the source's own `<br>` with the
 * break annotation) and its `close` is empty.
 */
type TemplateKind = MarkKind | "hard_break";
export type RichTextTemplates = Readonly<Partial<Record<TemplateKind, MarkTemplate>>>;

export interface InlineContext {
  readonly linkTags: ReadonlySet<string>;
  readonly constants: ModuleConstants;
  /** Whether a link may be a mark here. A list document carries none. */
  readonly allowLinks: boolean;
}

export type InlineBlockReading =
  | {
      readonly kind: "block";
      readonly inlines: readonly ManagedRichTextInline[];
      readonly templates: RichTextTemplates;
    }
  | { readonly kind: "computed"; readonly node: ts.Node }
  | { readonly kind: "unmapped"; readonly node: ts.Node; readonly reason: string };

/** What an element contributes: the mark, and how the source renders it. */
interface ElementPiece {
  readonly kind: "element";
  readonly mark: ManagedRichTextMark;
  readonly template: MarkTemplate;
  /** The source's own rendering of the element, compared against the value's. */
  readonly token: string;
  readonly children: readonly Piece[];
}

/** A line break, and the source's own element for it. */
interface BreakPiece {
  readonly kind: "break";
  readonly template: MarkTemplate;
}

type Piece = { readonly kind: "text"; readonly text: string } | ElementPiece | BreakPiece;

type Failure = Exclude<InlineBlockReading, { kind: "block" }>;

/** Weights at or above 600, the band CSS font matching treats as bold. */
const BOLD_WEIGHT_CLASSES: ReadonlySet<string> = new Set([
  "font-semibold",
  "font-bold",
  "font-extrabold",
  "font-black",
]);
const FONT_STYLE_CLASS = /^(not-italic|italic|font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black))$/u;

/** Whether a class token sets font style or weight, at any breakpoint or state. */
function isFontStyleToken(token: string): boolean {
  return FONT_STYLE_CLASS.test(token.split(":").at(-1) ?? "");
}
const TAG_MARKS: ReadonlyMap<string, MarkKind> = new Map([
  ["em", "italic"],
  ["i", "italic"],
  ["strong", "bold"],
  ["b", "bold"],
]);

/**
 * Host tags that start a block of their own. A text-bearing child with one of
 * these tags is structure, not formatting, so it does not turn its parent into
 * one formatted block: `<div>Intro <p>Body</p></div>` stays what it was.
 */
const BLOCK_LEVEL_TAGS: ReadonlySet<string> = new Set([
  "address", "article", "aside", "blockquote", "details", "dialog", "div", "dl",
  "fieldset", "figcaption", "figure", "footer", "form", "h1", "h2", "h3", "h4",
  "h5", "h6", "header", "hr", "li", "main", "nav", "ol", "p", "pre", "section",
  "summary", "table", "ul",
]);

/**
 * JSX text exactly as the compiler renders it: spaces and tabs are trimmed
 * where a line meets a line break, blank lines vanish, the rest join with one
 * space, and character references decode. Anything else survives as written
 * (a tab inside a line, a run of spaces, a non-breaking space at a line's
 * edge), so the value reproduces the page byte for byte rather than
 * approximately. This is the rule Next's compiler (SWC) applies; TypeScript's
 * differs only in also trimming a non-breaking space at a line's edge.
 *
 * Deliberately not `normaliseJsxText`, which collapses every run of whitespace:
 * a plain-text value is trimmed and placed back between the source's own
 * whitespace, so the collapse never reaches the page, but a formatted block's
 * value replaces every child and must carry the exact text. Moving the plain
 * readers onto this rule would re-spell values already converted.
 */
export function jsxTextValue(raw: string): string {
  const lines = raw.split(/\r\n|\n|\r/u);
  // Zero, not -1, as the compiler has it: a line of only spaces is kept as
  // written rather than given a separator it has nothing to separate.
  let lastNonEmpty = 0;
  lines.forEach((line, index) => {
    if (/[^ \t]/u.test(line)) lastNonEmpty = index;
  });
  let text = "";
  lines.forEach((line, index) => {
    let trimmed = line;
    if (index !== 0) trimmed = trimmed.replace(/^[ \t]+/u, "");
    if (index !== lines.length - 1) trimmed = trimmed.replace(/[ \t]+$/u, "");
    if (trimmed === "") return;
    text += index === lastNonEmpty ? trimmed : `${trimmed} `;
  });
  return decodeJsxEntities(text);
}

function holdsContent(element: JsxElementNode): boolean {
  return childrenOf(element).some((child) => {
    if (ts.isJsxText(child)) return jsxTextValue(child.text) !== "";
    if (ts.isJsxExpression(child)) return child.expression !== undefined;
    return isElementChild(child) && holdsContent(child);
  });
}

/**
 * Elements whose content is one run of text by nature: the blocks a customer
 * reads as one sentence or label. Their inline children are formatting even
 * when no bare text sits between them.
 */
const TEXT_BLOCK_TAGS: ReadonlySet<string> = new Set([
  "a", "blockquote", "button", "caption", "dd", "dt", "figcaption", "h1", "h2", "h3",
  "h4", "h5", "h6", "label", "legend", "li", "p", "summary",
]);

function isDirectText(child: ts.JsxChild): boolean {
  if (ts.isJsxText(child)) return jsxTextValue(child.text).trim() !== "";
  return ts.isJsxExpression(child) && (jsxExpressionStringValue(child) ?? "").trim() !== "";
}

/**
 * Whether an element's children make it ONE formatted block rather than a
 * container or a plain run of text.
 *
 * A line break always does. Otherwise it takes content-bearing inline children
 * (not an empty icon, not a block of their own, not `aria-hidden` decoration)
 * and a reason to read them as one sentence: bare text beside them, or a
 * text-block element holding more than one of them or a formatting tag. So
 * `<h3><Icon /> Services</h3>` stays heading text, `<div><span>A</span></div>`
 * stays a container, and `<p><a href="...">Read more</a></p>` stays the link it
 * always was.
 */
/** Whether an element's content is one run of text by nature (see `TEXT_BLOCK_TAGS`). */
export function isTextBlockTag(tag: string): boolean {
  return TEXT_BLOCK_TAGS.has(tag);
}

export function isFormattedBlock(textBlock: boolean, children: readonly ts.JsxChild[]): boolean {
  const elements = children.filter(isElementChild).filter(isWalkedElement);
  if (elements.some((child) => tagNameOf(child) === "br")) return true;
  const withContent = elements.filter(holdsContent);
  // A child that is a block of its own makes this a container of blocks, each
  // read on its own, whatever else sits beside it.
  if (withContent.some((child) => BLOCK_LEVEL_TAGS.has(tagNameOf(child)))) return false;
  if (withContent.length === 0) return false;
  if (children.some(isDirectText)) return true;
  // Formatting is formatting in any element, whether a tag or a span's class
  // says so (`<td><b>Note:</b> <i>fragile</i></td>`, `<div><strong>$99</strong></div>`,
  // `<a><span className="italic">Learn</span></a>`): the same classifier that
  // maps a mark decides it. Several inline runs without one are a sentence
  // only in a text block.
  if (withContent.some(mapsToFormatting)) return true;
  return textBlock && withContent.length > 1;
}

/** Whether an element is one the mark classifier maps to bold or italic. */
function mapsToFormatting(element: JsxElementNode): boolean {
  const tag = tagNameOf(element);
  if (TAG_MARKS.has(tag)) return true;
  if (tag !== "span") return false;
  const mark = spanMark(element);
  return mark === "bold" || mark === "italic";
}

function unmapped(node: ts.Node, reason: string): Failure {
  return { kind: "unmapped", node, reason };
}

/** Attributes the template can copy verbatim: literal values or bare names. */
function staticAttributes(element: JsxElementNode, dynamicAllowed: ReadonlySet<string>): boolean {
  const opening = ts.isJsxElement(element) ? element.openingElement : element;
  if (opening.attributes.properties.some((property) => ts.isJsxSpreadAttribute(property))) {
    return false;
  }
  return namedAttributes(element).every(
    (attribute) =>
      dynamicAllowed.has(attribute.name) ||
      attribute.node.initializer === undefined ||
      literalAttributeValue(attribute.node) !== null,
  );
}

function classTokens(element: JsxElementNode): readonly string[] | null {
  const attribute = findAttribute(element, "className") ?? findAttribute(element, "class");
  if (attribute === null) return [];
  const value = literalAttributeValue(attribute);
  return value === null ? null : value.split(/\s+/u).filter((token) => token !== "");
}

/** The mark a span's classes clearly name, or why they do not name one. */
function spanMark(element: JsxElementNode): MarkKind | string {
  const tokens = classTokens(element);
  if (tokens === null) return "its class is not a literal";
  const styling = tokens.filter(isFontStyleToken);
  if (styling.some((token) => token.includes(":") || token === "not-italic")) {
    return "its class sets formatting only at a breakpoint or state, or turns it off";
  }
  const marks = new Set<MarkKind>();
  for (const token of styling) {
    if (token === "italic") marks.add("italic");
    else if (BOLD_WEIGHT_CLASSES.has(token)) marks.add("bold");
    else return "its class sets a weight lighter than bold, which no mark says";
  }
  if (marks.size > 1) return "its class sets more than one mark on one element";
  const [mark] = marks;
  return mark ?? "its classes name no mark (italic, a bold weight) and nothing else maps it";
}

interface Edit {
  readonly at: number;
  readonly end: number;
  readonly text: string;
}

/** The opening tag's source text with edits applied, offsets from its start. */
function openingWith(
  opening: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
  edits: readonly Edit[],
): string {
  const start = opening.getStart();
  let text = opening.getText();
  for (const edit of [...edits].sort((a, b) => b.at - a.at)) {
    text = text.slice(0, edit.at - start) + edit.text + text.slice(edit.end - start);
  }
  return text;
}

/** The mark annotation, last among the attributes, after anything `before` adds. */
function annotation(kind: MarkKind, opening: ts.JsxOpeningElement, before = ""): Edit {
  const at = opening.attributes.getEnd();
  return { at, end: at, text: `${before} ${MANAGED_RICH_TEXT_MARK_ATTRIBUTE}="${kind}"` };
}

/** An attribute's value replaced by an expression; a bare attribute gains one. */
function replaced(attribute: ts.JsxAttribute, text: string): Edit {
  const initializer = attribute.initializer;
  if (initializer === undefined) {
    const at = attribute.getEnd();
    return { at, end: at, text: `=${text}` };
  }
  return { at: initializer.getStart(), end: initializer.getEnd(), text };
}

function linkToken(template: MarkTemplate, href: string, target: string | undefined): string {
  return `${template.open}|${href}|${target ?? ""}`;
}

type Classified =
  | { readonly mark: ManagedRichTextMark; readonly template: MarkTemplate; readonly token: string }
  | Failure;

function classifyLink(element: ts.JsxElement, context: InlineContext): Classified {
  if (!context.allowLinks) return unmapped(element, "a link cannot be a mark here");
  const opening = element.openingElement;
  const href = findAttribute(element, "href");
  const expression = href === null ? null : attributeExpression(href);
  const raw = expression === null ? null : readDestination(expression, context.constants);
  const destination = raw === null ? null : offSiteDestination(raw);
  if (href === null || expression === null || raw === null || destination === null) {
    return unmapped(
      element,
      "a link inside formatted text must go to an https URL, an email address or a " +
        "phone number written as a literal; a link to a page of this site or a fragment " +
        "has no rich-text destination yet",
    );
  }
  if (!staticAttributes(element, new Set(["href"]))) {
    return unmapped(element, "a link's other attributes are not a literal");
  }
  const target = findAttribute(element, "target");
  const targetLiteral = target === null ? undefined : literalAttributeValue(target);
  if (targetLiteral === null) return unmapped(element, "a link's target is not a literal");
  const edits: Edit[] = [replaced(href, "{link.href}")];
  // A target the source never wrote is appended rather than inserted, so an
  // element rendering the same window keeps exactly the attributes it had.
  // So is rel={link.rel}, which renders only for a new window: a customer who
  // switches a link to open in one gets rel="noopener noreferrer" with it. A
  // rel the source wrote is its own, and stays.
  const appended =
    (target === null ? " target={link.target}" : "") +
    (findAttribute(element, "rel") === null ? " rel={link.rel}" : "");
  if (target !== null) edits.push(replaced(target, "{link.target}"));
  edits.push(annotation("link", opening, appended));
  const template = { open: openingWith(opening, edits), close: element.closingElement.getText() };
  const hrefLiteral = resolvedStringValueOf(expression, context.constants) ?? "";
  // JSX decodes a reference in an attribute string, so the href the page uses
  // is not the text read here. Refused rather than decoded twice over.
  if (decodeJsxEntities(hrefLiteral) !== hrefLiteral) {
    return unmapped(element, "a link's href carries a character reference");
  }
  const mark: LinkMark = {
    type: "link",
    destination,
    target: targetLiteral === "_blank" ? "new_window" : "same_window",
  };
  return { mark, template, token: linkToken(template, hrefLiteral, targetLiteral) };
}

/**
 * A `<br>` is a hard break, rendered through the source's own element with the
 * break annotation last among its attributes, so a class that makes it
 * responsive (`hidden md:block`) still does. Its attributes must be literal,
 * as a mark element's are, because the template copies them verbatim.
 */
function readBreak(element: JsxElementNode): BreakPiece | Failure {
  if (!ts.isJsxSelfClosingElement(element)) {
    return unmapped(element, "a line break with children has no rich-text node");
  }
  if (!staticAttributes(element, new Set())) {
    return unmapped(element, "a line break carries an attribute that is not a literal");
  }
  const at = element.attributes.getEnd();
  const open = openingWith(element, [
    { at, end: at, text: ` ${MANAGED_RICH_TEXT_BREAK_ATTRIBUTE}=""` },
  ]);
  return { kind: "break", template: { open, close: "" } };
}

function classify(element: JsxElementNode, context: InlineContext): Classified {
  const tag = tagNameOf(element);
  if (!ts.isJsxElement(element) || !isWalkedElement(element)) {
    return unmapped(element, `<${tag}> maps to no mark`);
  }
  if (context.linkTags.has(tag)) return classifyLink(element, context);
  if (isComponentName(tag)) return unmapped(element, `<${tag}> is a component, which maps to no mark`);
  if (!staticAttributes(element, new Set())) {
    return unmapped(element, `<${tag}> carries an attribute that is not a literal`);
  }
  const byTag = TAG_MARKS.get(tag);
  const kind: MarkKind | string =
    byTag !== undefined
      ? restyled(element) ?? byTag
      : tag === "span"
        ? spanMark(element)
        : `<${tag}> maps to no mark`;
  if (kind !== "bold" && kind !== "italic") return unmapped(element, kind);
  const opening = element.openingElement;
  const template = {
    open: openingWith(opening, [annotation(kind, opening)]),
    close: element.closingElement.getText(),
  };
  return { mark: { type: kind }, template, token: template.open };
}

/** Why a mark element's own classes make its meaning unclear, if they do. */
function restyled(element: JsxElementNode): string | null {
  const tokens = classTokens(element);
  if (tokens === null) return "its class is not a literal";
  return tokens.some(isFontStyleToken)
    ? "its class restyles the mark it would otherwise be, so it has no clear mark"
    : null;
}

function readPieces(
  children: readonly ts.JsxChild[],
  outer: readonly MarkKind[],
  context: InlineContext,
): readonly Piece[] | Failure {
  const pieces: Piece[] = [];
  for (const child of children) {
    if (ts.isJsxText(child)) {
      pieces.push({ kind: "text", text: jsxTextValue(child.text) });
      continue;
    }
    if (ts.isJsxExpression(child)) {
      // `{/* note */}` renders nothing; `{" "}` renders its string.
      if (child.expression === undefined) continue;
      const text = jsxExpressionStringValue(child);
      if (text === null) return { kind: "computed", node: child };
      pieces.push({ kind: "text", text });
      continue;
    }
    if (!isElementChild(child)) return unmapped(child, "a fragment maps to no mark");
    if (tagNameOf(child) === "br") {
      const read = readBreak(child);
      if (read.kind !== "break") return read;
      pieces.push(read);
      continue;
    }
    const classified = classify(child, context);
    if ("kind" in classified) return classified;
    const kind = classified.mark.type;
    if (outer.includes(kind)) {
      return unmapped(child, `a ${kind} mark sits inside itself, which one mark cannot say`);
    }
    const inner = readPieces(childrenOf(child), [...outer, kind], context);
    if (!Array.isArray(inner)) return inner as Failure;
    pieces.push({ kind: "element", ...classified, children: inner });
  }
  return pieces;
}

/**
 * Adjacent text carrying the same marks is one text node: the page renders it
 * as one run, and one run of prose has one spelling. Two adjacent ELEMENTS of
 * one mark merge here too, and the comparison below refuses that for rendering
 * one element where the source had two.
 */
function mergedInlines(inlines: readonly ManagedRichTextInline[]): readonly ManagedRichTextInline[] {
  const merged: ManagedRichTextInline[] = [];
  for (const inline of inlines) {
    const previous = merged.at(-1);
    if (
      previous?.type === "text" &&
      inline.type === "text" &&
      canonicalizeJson(previous.marks ?? []) === canonicalizeJson(inline.marks ?? [])
    ) {
      merged[merged.length - 1] = { ...previous, text: previous.text + inline.text };
    } else {
      merged.push(inline);
    }
  }
  return merged;
}

function inlinesOf(
  pieces: readonly Piece[],
  marks: readonly ManagedRichTextMark[],
): readonly ManagedRichTextInline[] {
  return pieces.flatMap((piece): readonly ManagedRichTextInline[] => {
    if (piece.kind === "element") return inlinesOf(piece.children, [...marks, piece.mark]);
    // A break carries no marks: where it renders follows from its neighbours.
    if (piece.kind === "break") return [{ type: "hard_break" }];
    if (piece.text === "") return [];
    // Unmarked text omits `marks` entirely: one run of prose has one spelling.
    return [marks.length === 0 ? { type: "text", text: piece.text } : { type: "text", text: piece.text, marks }];
  });
}

type Token = { readonly text: string } | { readonly open: string } | { readonly close: string };

function sourceTokens(pieces: readonly Piece[]): Token[] {
  return pieces.flatMap((piece): Token[] => {
    if (piece.kind === "text") return [{ text: piece.text }];
    if (piece.kind === "break") return [{ open: piece.template.open }];
    return [{ open: piece.token }, ...sourceTokens(piece.children), { close: piece.template.close }];
  });
}

function renderedTokens(spans: readonly ManagedRichTextSpan[], templates: RichTextTemplates): Token[] {
  return spans.flatMap((span): Token[] => {
    if (span.kind === "text") return [{ text: span.text }];
    if (span.kind === "hard_break") return [{ open: templates.hard_break!.open }];
    const template = templates[span.mark.type]!;
    const link = span.mark.type === "link" ? managedRichTextLinkAttributesV1(span.mark) : null;
    const open = link === null ? template.open : linkToken(template, link.href, link.target);
    return [{ open }, ...renderedTokens(span.children, templates), { close: template.close }];
  });
}

/**
 * Adjacent text concatenated, as the page renders it. Nothing is trimmed: the
 * value holds exactly the text JSX renders, edges included, so the rewritten
 * element renders the same bytes rather than nearly the same.
 */
function canonicalTokens(tokens: readonly Token[]): string {
  const merged: Token[] = [];
  for (const token of tokens) {
    const previous = merged.at(-1);
    if ("text" in token && previous !== undefined && "text" in previous) {
      merged[merged.length - 1] = { text: previous.text + token.text };
    } else {
      merged.push(token);
    }
  }
  return JSON.stringify(merged.filter((token) => !("text" in token) || token.text !== ""));
}

function templatesOf(pieces: readonly Piece[], into: Partial<Record<TemplateKind, MarkTemplate>>): void {
  for (const piece of pieces) {
    if (piece.kind === "break") into.hard_break ??= piece.template;
    if (piece.kind !== "element") continue;
    into[piece.mark.type] ??= piece.template;
    templatesOf(piece.children, into);
  }
}

/**
 * Reads a formatted block's children as one value, or says why it cannot.
 *
 * `node` names what to report a refusal against; the element itself when the
 * refusal is about the block as a whole.
 */
export function readInlineBlock(
  node: ts.Node,
  children: readonly ts.JsxChild[],
  context: InlineContext,
): InlineBlockReading {
  const pieces = readPieces(children, [], context);
  if (!Array.isArray(pieces)) return pieces as Failure;
  const inlines = mergedInlines(inlinesOf(pieces, []));
  if (inlines.length === 0) return unmapped(node, "the block holds no text");
  const templates: Partial<Record<TemplateKind, MarkTemplate>> = {};
  templatesOf(pieces, templates);
  const source = canonicalTokens(sourceTokens(pieces));
  const rendered = canonicalTokens(renderedTokens(groupManagedRichTextInlines(inlines), templates));
  if (source !== rendered) {
    return unmapped(
      node,
      "the block renders differently from the source once read as one value (adjacent " +
        "runs of one mark, one mark written two ways, an empty element, or a link target " +
        "the contract cannot state)",
    );
  }
  // The value must be one the contract parses: a link the reader accepts can
  // still name an address or number the contract refuses, and that would null
  // the whole proposed contract with nothing pointing at this block.
  try {
    parseManagedRichTextDocument({ type: "doc", content: [{ type: "paragraph", content: inlines }] });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return unmapped(node, `the contract refuses the value it reads as (${detail})`);
  }
  return { kind: "block", inlines, templates };
}
