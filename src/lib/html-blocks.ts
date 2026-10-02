/**
 * A post body to the block AST, built from tag structure.
 *
 * Roughly 38% of the posts the content pipeline publishes are raw HTML
 * (`<p>`, `<h2>`, `<table>`, `<div>`, plus an inlined
 * `<script type="application/ld+json">`), the rest are markdown, and some are
 * both. There is one path for all of them: the scanner runs over every body,
 * this module builds the blocks from the tags it found, and the markdown
 * grammar in `markdown-text.ts` runs on the text between them. A body with no
 * tags in it is one text node, which is the degenerate case and costs nothing.
 *
 * The invariant this exists to hold:
 *
 *   Every construct the content pipeline can emit renders as a Block. Nothing
 *   reaches the page as literal markup.
 *
 * HTML is the outer grammar because it is the one that owns the body's
 * structure: a tag says where a block begins and where an inline run ends, and
 * only text can say anything else. Deciding per body which grammar to believe
 * was the previous design, and it had to be right about a whole document from
 * line shapes; this one never asks the question, so it cannot answer it wrong.
 *
 * It is deliberately hand-rolled and deliberately bounded. `src/` here
 * propagates to roughly 276 customer sites, so a runtime dependency for a
 * build-time concern is 276 lockfile changes and a supply-chain surface; the
 * house style (`imageHeader.ts`) is hand-rolled parsers for the same reason.
 * The input is not arbitrary web HTML, it is our own pipeline's output over a
 * small, observable tag set.
 *
 * Three rules decide every case this parser does not otherwise know:
 *
 *  1. `<script>`, `<style>`, `<template>`, `<noscript>` and HTML comments are
 *     dropped whole, content included.
 *  2. Any other unrecognised tag is unwrapped: the tag goes, its children stay.
 *  3. Entities are decoded.
 *
 * Rules 1 and 2 are the fail-closed direction for a renderer. Losing a wrapper
 * degrades presentation; leaking one degrades the page into visible source.
 * Nothing in this module ever puts markup into a text node.
 *
 * Four layers: `html-tags.ts` is the policy (which tag becomes what),
 * `html-tokens.ts` is the scanner (source to a tree), `markdown-text.ts` is the
 * grammar for the text between tags, and this module turns the tree into
 * Blocks.
 *
 * It emits no Block kind that `markdown.ts` does not already declare in
 * `BLOCK_KINDS`. That set is a cross-repo contract (see `SUPPORTED_BLOCKS` in
 * the MEGA go-live blog migrator) and widening it here would desynchronise it.
 */

import type { Block, ListItem, ListNode } from "./markdown";

import {
  CELL_TAGS,
  HEAD_TAGS,
  ITEM_AND_LIST_TAGS,
  ITEM_TAGS,
  LIST_TAGS,
  ROW_TAGS,
  TABLE_SECTIONS,
  TABLE_TAGS,
  isOrderedList,
  roleFor,
  type TagRole,
} from "./html-tags";

import {
  buildTree,
  collapseAndDecode,
  decodeEntities,
  tokenize,
  verbatimSource,
  type ElementNode,
  type HtmlNode,
} from "./html-tokens";

import { collapseMark, imageSrc, linkHref, plainText, trimInline, type InlineNode } from "./inline";

import {
  SPACE,
  blockFromInline,
  blocksFromPieces,
  headingBlock,
  inlineFromPieces,
  tableBlock,
  type Context,
  type Piece,
} from "./markdown-text";

/** One accumulator for the whole subtree, filled in place. Joining on the way
 * out of each node instead would re-copy the text once per node. */
function collectText(node: HtmlNode, collapse: boolean, parts: string[]): void {
  if (node.type === "text") {
    parts.push(collapse ? collapseAndDecode(node.value) : decodeEntities(node.value));
  } else if (node.type === "verbatim") {
    // Raw text, so the delimiters are characters of the body: `<pre>a `b` c` is
    // three words and two backticks, not a code span nested in a code block.
    parts.push(verbatimSource(node));
  } else {
    for (const child of node.children) collectText(child, collapse, parts);
  }
}

/** The text of a subtree. `collapse` is false for `<pre>`, which is verbatim. */
function textOf(node: HtmlNode, collapse: boolean): string {
  const parts: string[] = [];
  collectText(node, collapse, parts);
  return parts.join("");
}

/* -------------------------------------------------------------------------- */
/* Inline                                                                      */
/* -------------------------------------------------------------------------- */

function piecesFromNodes(nodes: HtmlNode[], excluded?: ReadonlySet<string>): Piece[] {
  return nodes.flatMap((node) => piecesFromNode(node, excluded));
}

/**
 * An `<img>`.
 *
 * The alt is an attribute, not body text: the scanner already decoded it and
 * the markdown grammar never runs on one, so it becomes a finished node rather
 * than re-entering the text stream — which is what keeps
 * `alt="A &amp;amp; B"` from being decoded a second time.
 */
function imagePieces(node: ElementNode, excluded?: ReadonlySet<string>): Piece[] {
  const alt = node.attrs.alt ?? "";
  const src = imageSrc(node.attrs.src ?? "");
  // A refused src loses the image, never its words: the alt is the only text
  // the image carried, and dropping it silently loses content.
  if (src !== null) return [{ kind: "image", src, alt }];
  const children = piecesFromNodes(node.children, excluded);
  if (children.length > 0) return children;
  return alt === "" ? [] : [{ kind: "text", value: alt }];
}

/** An `<a>`. A refused scheme loses the anchor, never the words inside it. */
function linkPieces(node: ElementNode, excluded?: ReadonlySet<string>): Piece[] {
  const children = inlineFromPieces(piecesFromNodes(node.children, excluded));
  const href = linkHref(node.attrs.href ?? "");
  if (href === null) return children;
  // `plainText` resolves an image to its alt, so an anchor whose only content
  // is an image still becomes a clickable link named by that alt.
  const text = plainText(children).trim();
  return text === "" ? children : [{ kind: "link", text, href }];
}

/**
 * One node as the pieces it contributes to the run of body text around it.
 *
 * Text stays text — uncollapsed, unparsed, and still carrying its newlines —
 * because only the markdown grammar knows where a line matters. An element
 * becomes finished nodes, which the markdown grammar can bracket but can never
 * reopen. An unwrapped tag contributes its children directly, so the text on
 * either side of it is genuinely contiguous and a mark may span the gap the
 * tag left.
 */
function piecesFromNode(node: HtmlNode, excluded?: ReadonlySet<string>): Piece[] {
  if (node.type === "text") return [node.value];
  // Content, not markup: a fenced block met inline is still just its text.
  if (node.type === "verbatim") return [{ kind: "code", value: node.text }];
  if (excluded?.has(node.tag)) return [];

  const role = roleFor(node.tag);
  if (role.flow !== "inline") {
    // A block or an unknown tag met in inline position contributes its
    // contents. `InlineNode` has no nesting, so this is the only lossless move.
    const children = piecesFromNodes(node.children, excluded);
    // Losing the wrapper is the accepted degradation; losing the word boundary
    // is not. Real bodies write `</strong><p>` with no whitespace between, and
    // "Drain cleaningWe clear clogs" is text no reader can parse.
    if (role.flow === "block" && children.length > 0) return [SPACE, ...children, SPACE];
    return children;
  }

  switch (role.inline) {
    case "space":
      return [SPACE];
    case "image":
      return imagePieces(node, excluded);
    case "link":
      return linkPieces(node, excluded);
    case "code": {
      const text = textOf(node, true);
      return text === "" ? [] : [{ kind: "code", value: text }];
    }
    case "strong":
    case "em": {
      const children = inlineFromPieces(piecesFromNodes(node.children, excluded));
      return collapseMark(role.inline, children);
    }
    default: {
      const unreachable: never = role.inline;
      return unreachable;
    }
  }
}

function inlineFromNodes(nodes: HtmlNode[], excluded?: ReadonlySet<string>): InlineNode[] {
  return trimInline(inlineFromPieces(piecesFromNodes(nodes, excluded)));
}

/* -------------------------------------------------------------------------- */
/* Blocks                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Elements matching `tags`, not descending into a match and not crossing a
 * `stopAt` boundary. That boundary is what keeps a `<table>` nested inside a
 * `<td>` from donating its rows to the outer table.
 */
function collectDescendants(
  node: ElementNode,
  tags: ReadonlySet<string>,
  stopAt: ReadonlySet<string>,
): ElementNode[] {
  const found: ElementNode[] = [];
  const walk = (children: HtmlNode[]): void => {
    for (const child of children) {
      if (child.type !== "element") continue;
      if (tags.has(child.tag)) {
        found.push(child);
        continue;
      }
      if (stopAt.has(child.tag)) continue;
      walk(child.children);
    }
  };
  walk(node.children);
  return found;
}

function containsBlock(node: ElementNode): boolean {
  return node.children.some((child) => {
    if (child.type !== "element") return false;
    const role = roleFor(child.tag);
    if (role.flow === "block") return true;
    if (role.flow === "structure") return containsBlock(child);
    return false;
  });
}

function listFrom(node: ElementNode, ordered: boolean): ListNode {
  const items: ListItem[] = collectDescendants(node, ITEM_TAGS, LIST_TAGS).map((li) => ({
    inline: inlineFromNodes(li.children, LIST_TAGS),
    children: collectDescendants(li, LIST_TAGS, LIST_TAGS).map((nested) =>
      listFrom(nested, isOrderedList(nested.tag)),
    ),
  }));
  // `<ul>bare text</ul>` would otherwise render an empty list and lose the text.
  const stray = inlineFromNodes(node.children, ITEM_AND_LIST_TAGS);
  if (stray.length > 0) {
    const firstItem = node.children.findIndex(
      (child) => child.type === "element" && ITEM_TAGS.has(child.tag),
    );
    const firstStray = node.children.findIndex(
      (child) => child.type === "text" && child.value.trim() !== "",
    );
    // Keep its place: lead-in text before the first `<li>` reads wrong last.
    const item: ListItem = { inline: stray, children: [] };
    if (firstItem === -1 || (firstStray !== -1 && firstStray < firstItem)) items.unshift(item);
    else items.push(item);
  }
  return { ordered, items };
}

function cellsIn(row: ElementNode): ElementNode[] {
  return collectDescendants(row, CELL_TAGS, TABLE_TAGS);
}

function inlineCells(cells: ElementNode[]): InlineNode[][] {
  return cells.map((cell) => inlineFromNodes(cell.children));
}

function tableBlocks(node: ElementNode): Block[] {
  const headRow = collectDescendants(node, HEAD_TAGS, TABLE_TAGS)
    .flatMap((head) => collectDescendants(head, ROW_TAGS, TABLE_TAGS))
    .at(0);
  const allRows = collectDescendants(node, ROW_TAGS, TABLE_TAGS);
  // Without a `thead`, a row made entirely of `th` is still the header. A row
  // of `td` is data: promoting it would invent a header the source did not have.
  const firstCells = allRows.length > 0 ? cellsIn(allRows[0]) : [];
  const header =
    headRow ??
    (firstCells.length > 0 && firstCells.every((cell) => cell.tag === "th")
      ? allRows[0]
      : undefined);

  const headerCells = header === undefined ? [] : inlineCells(cellsIn(header));
  const rows = allRows.filter((row) => row !== header).map((row) => inlineCells(cellsIn(row)));

  const blocks: Block[] = [];
  // A `<caption>` (or any other stray content) is unwrapped by rule 2 and lands
  // here as loose inline. Emitting it before the table keeps the text.
  const lead = blockFromInline(inlineFromNodes(node.children, TABLE_SECTIONS));
  if (lead !== null) blocks.push(lead);
  const table = tableBlock(headerCells, rows);
  if (table !== null) blocks.push(table);
  return blocks;
}

/** A nested block flattened into blockquote lines, so nothing inside a quote
 * is dropped for want of a place to put it. */
function blockToLines(block: Block): InlineNode[][] {
  switch (block.kind) {
    case "paragraph":
    case "heading":
      return [block.inline];
    case "list": {
      // Recursive: a nested group lives on `item.children`, and taking only
      // `item.inline` dropped every child item a quoted list carried.
      const lines = (items: ListItem[]): InlineNode[][] =>
        items.flatMap((item) => [
          item.inline,
          ...item.children.flatMap((group) => lines(group.items)),
        ]);
      return lines(block.items);
    }
    case "blockquote":
      return block.lines;
    case "table":
      return [block.header, ...block.rows].map((row) => row.flat());
    case "code":
      return [[{ kind: "text", value: block.text }]];
    case "image":
      return [[{ kind: "image", src: block.src, alt: block.alt }]];
    default: {
      const unreachable: never = block;
      return unreachable;
    }
  }
}

/**
 * One block-level element as the blocks it becomes.
 *
 * Exhaustive over `role.block` on purpose: the `never` binding stops compiling
 * the day a block role is added to `html-tags.ts`, rather than letting the new
 * kind fall into whichever branch happens to sit last and render as a `<pre>`.
 */
function blocksFromElement(
  child: ElementNode,
  role: Extract<TagRole, { flow: "block" }>,
  context: Context,
): Block[] {
  switch (role.block) {
    case "paragraph": {
      // A paragraph element IS the block, so its text is read for inline marks
      // only: `<p>## Head</p>` is a paragraph that starts with two hashes.
      const block = blockFromInline(inlineFromPieces(piecesFromNodes(child.children)));
      return block === null ? [] : [block];
    }
    case "heading":
      return headingBlock(
        role.level,
        inlineFromNodes(child.children),
        role.dropWhenLeading === true,
        context,
      );
    case "list": {
      const list = listFrom(child, role.ordered);
      return list.items.length === 0
        ? []
        : [{ kind: "list", ordered: list.ordered, items: list.items }];
    }
    case "blockquote": {
      const lines = blocksFromNodes(child.children, { leading: false })
        .flatMap(blockToLines)
        .filter((line) => line.length > 0);
      return lines.length === 0 ? [] : [{ kind: "blockquote", lines }];
    }
    case "table":
      return tableBlocks(child);
    case "code": {
      const text = textOf(child, false).replace(/^\n+/, "").trimEnd();
      return text === "" ? [] : [{ kind: "code", text }];
    }
    default: {
      const unreachable: never = role;
      return unreachable;
    }
  }
}

function blocksFromNodes(nodes: HtmlNode[], context: Context): Block[] {
  const blocks: Block[] = [];
  let pending: Piece[] = [];

  const push = (block: Block): void => {
    blocks.push(block);
    context.leading = false;
  };

  /**
   * The run of body text collected since the last element. This is the only
   * place block-level markdown is read, because it is the only place a block
   * could begin: inside a `<p>` the paragraph is already decided.
   */
  const flush = (): void => {
    const run = pending;
    pending = [];
    for (const block of blocksFromPieces(run, context)) push(block);
  };

  const visit = (children: HtmlNode[]): void => {
    for (const child of children) {
      // A block-level fenced region is its own block; everything else a node
      // contributes joins the run of text around it.
      if (child.type === "verbatim" && child.block) {
        flush();
        push({ kind: "code", text: child.text });
        continue;
      }
      if (child.type !== "element") {
        pending.push(...piecesFromNode(child));
        continue;
      }
      const role = roleFor(child.tag);
      if (role.flow === "inline") {
        pending.push(...piecesFromNode(child));
        continue;
      }
      if (role.flow !== "block") {
        // Rule 2, and the same path a `<li>` outside a list takes. A dropped
        // element cannot reach here: `buildTree` never attaches one.
        // A named part is a cell or an item, so it needs a separator or
        // `<li>c<li>d` outside a list reads as the non-word "cd".
        if (role.flow === "structure" && role.part !== undefined) pending.push(SPACE);
        visit(child.children);
        continue;
      }
      if (role.block === "paragraph" && containsBlock(child)) {
        // `<div class="answer-capsule"><p>…</p></div>` is a wrapper, not a
        // paragraph. Unwrapping it is what keeps nested divs from multiplying.
        visit(child.children);
        continue;
      }
      flush();
      for (const block of blocksFromElement(child, role, context)) push(block);
    }
  };

  visit(nodes);
  flush();
  return blocks;
}

/* -------------------------------------------------------------------------- */
/* Entry points                                                                */
/* -------------------------------------------------------------------------- */

/** A published body as blocks. Never emits a Block kind outside `BLOCK_KINDS`. */
export function parseHtmlBody(source: string): Block[] {
  if (source.trim() === "") return [];
  const context: Context = { leading: true };
  const blocks = blocksFromNodes(buildTree(tokenize(source)).children, context);
  // A body that is nothing but its title is not a duplicate of anything, and a
  // blank article would be a silent failure with nothing to see.
  if (blocks.length === 0 && context.droppedTitle !== undefined) return [context.droppedTitle];
  return blocks;
}

/** A body fragment as inline nodes: the same pipeline, stopped short of blocks. */
export function inlineFromBody(source: string): InlineNode[] {
  return inlineFromNodes(buildTree(tokenize(source)).children);
}
