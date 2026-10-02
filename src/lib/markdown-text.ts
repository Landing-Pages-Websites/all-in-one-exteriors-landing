/**
 * The markdown grammar, and only ever the text between tags.
 *
 * HTML is the outer grammar for a post body: `html-tokens.ts` scans the whole
 * body first and `html-blocks.ts` builds the block tree from tag structure.
 * What is left over is text, and text is where markdown lives. A body with no
 * tags in it is one text node, which is the degenerate case and costs nothing.
 *
 * Nothing here ever sees a tag, so nothing here can cut one apart, hide one
 * from the scanner, or put one back afterwards. A node the HTML layer already
 * produced arrives as a `Piece` and is opaque: this grammar can bracket one,
 * and can decline to build a URL out of one, but it cannot look inside one and
 * it cannot turn one back into markup.
 *
 * That is the whole reason this module exists as a separate pass rather than as
 * a mask over the source string. A mask is a string, and a string can be
 * collided with, reordered, or reassembled into markup that an earlier check
 * already passed. A list of pieces can be none of those things.
 */

import { headingLevel } from "./html-tags";
import { collapseAndDecode } from "./html-tokens";
import {
  collapseMark,
  imageSrc,
  linkHref,
  plainText,
  trimInline,
  type InlineNode,
} from "./inline";
import type { Block, ListItem, ListNode } from "./markdown";

/**
 * A run of body text, or one node the HTML layer already finished standing
 * where its tag was. The seam between the two grammars.
 *
 * A string is source this grammar may still read; anything else is done with,
 * and `typeof` is the whole discrimination. That is what makes a node opaque by
 * construction rather than by discipline.
 */
export type Piece = string | InlineNode;

/**
 * Whether the document is still at its first block, which is what makes an `h1`
 * (or a `#`) the pipeline's duplicate of the post title. One object for the
 * whole body, because a title can only be dropped once however it was written.
 */
export interface Context {
  leading: boolean;
  /** The dropped heading, kept so a body that was nothing else can show it. */
  droppedTitle?: Block;
}

/** The separator between two runs that were separate lines, cells or items. */
export const SPACE: Piece = " ";

/* -------------------------------------------------------------------------- */
/* Inline                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The same pieces with every text run split into single characters.
 *
 * Characters, not runs, because a markdown mark can legitimately bracket a tag:
 * the `**` in `**<a href="/x">Buy</a>**` opens in one text node and closes in
 * another. A node occupies exactly one cell and matches no delimiter, so it can
 * sit inside a mark without ever being confused for one.
 */
function charactersOf(pieces: Piece[]): Piece[] {
  const cells: Piece[] = [];
  for (const piece of pieces) {
    if (typeof piece !== "string") cells.push(piece);
    // By code point, so an astral character is one cell and cannot be split.
    else for (const character of piece) cells.push(character);
  }
  return cells;
}

function indexOfCell(cells: Piece[], character: string, from: number): number {
  for (let index = from; index < cells.length; index += 1) {
    if (cells[index] === character) return index;
  }
  return -1;
}

/**
 * A forward search for one delimiter that never rescans.
 *
 * Every caller asks with a non-decreasing `from`, because the tokenizer only
 * moves forward. So a remembered hit at or after `from` is still the first one,
 * and a remembered miss is a miss for every later `from` too — which is what
 * keeps a body of nothing but `[` linear instead of scanning its tail once per
 * bracket.
 */
interface Cursor {
  from: number;
  at: number;
}

function cursorFor(cells: Piece[], character: string): Cursor {
  return { from: 0, at: indexOfCell(cells, character, 0) };
}

/** The first `character` at or after `from`. A node cell is not a character, so
 * it neither matches a delimiter nor terminates the search. */
function nextCell(cells: Piece[], character: string, cursor: Cursor, from: number): number {
  if (from > cursor.from && cursor.at !== -1 && cursor.at < from) {
    cursor.at = indexOfCell(cells, character, from);
    cursor.from = from;
  }
  return cursor.at;
}

/**
 * The characters between `from` and `to`, or null when a node sits inside.
 *
 * This is the rule that makes a URL impossible to assemble out of markup: a
 * destination is one contiguous run of source text or it is not a destination.
 * `[Click](java<b>script</b>:alert)` has a node in its destination, so it never
 * becomes a link and there is no string for a scheme check to be run on the
 * wrong side of.
 */
function textBetween(cells: Piece[], from: number, to: number): string | null {
  let text = "";
  for (let index = from; index < to; index += 1) {
    const cell = cells[index];
    if (typeof cell !== "string") return null;
    text += cell;
  }
  return text;
}

/**
 * A run of literal characters as a text node.
 *
 * Entities decode AFTER the markdown tokenizer has run, so
 * `&#42;&#42;x&#42;&#42;` is the text `**x**` and not bold. An entity can name a
 * character; it cannot name syntax.
 */
function textNodes(value: string): InlineNode[] {
  const text = collapseAndDecode(value);
  return text === "" ? [] : [{ kind: "text", value: text }];
}

interface Token {
  nodes: InlineNode[];
  end: number;
}

/** One run's cells and the delimiter cursors over them, so no character of it
 * is ever scanned twice. */
interface Scan {
  cells: Piece[];
  bracket: Cursor;
  paren: Cursor;
  star: Cursor;
}

/**
 * `[text](href)` and `![alt](src)`, which differ only in where the label starts,
 * whether an empty one is allowed, and which URL policy judges the destination.
 *
 * A refused or unbuildable URL costs the anchor or the image, never its words —
 * and the words stay PARSED, so `[**Click**](javascript:x)` keeps its bold
 * rather than printing its own asterisks.
 */
function readBracketed(scan: Scan, at: number, image: boolean): Token | null {
  const { cells } = scan;
  const from = at + (image ? 2 : 1);
  const close = nextCell(cells, "]", scan.bracket, from);
  // A link needs a label; an image's alt may be empty.
  if (close === -1 || (!image && close === from) || cells[close + 1] !== "(") return null;
  const shut = nextCell(cells, ")", scan.paren, close + 2);
  if (shut === -1 || shut === close + 2) return null;

  const label = inlineFromCells(cells.slice(from, close));
  const raw = textBetween(cells, close + 2, shut);
  const url = raw === null ? null : image ? imageSrc(raw) : linkHref(raw);
  if (url === null) return { nodes: label, end: shut + 1 };
  const node: InlineNode = image
    ? { kind: "image", alt: plainText(label), src: url }
    : { kind: "link", text: plainText(label), href: url };
  return { nodes: [node], end: shut + 1 };
}

/** `**strong**` or `*em*`. Neither may contain a `*`, which is what keeps the
 * two apart and keeps `*A caption*` from eating the rest of a paragraph. */
function readMark(scan: Scan, at: number): Token | null {
  const { cells } = scan;
  const double = cells[at + 1] === "*";
  const from = at + (double ? 2 : 1);
  const close = nextCell(cells, "*", scan.star, from);
  if (close === -1 || close === from) return null;
  if (double && cells[close + 1] !== "*") return null;
  return {
    nodes: collapseMark(double ? "strong" : "em", inlineFromCells(cells.slice(from, close))),
    end: close + (double ? 2 : 1),
  };
}

function readToken(scan: Scan, at: number): Token | null {
  const cell = scan.cells[at];
  if (cell === "!" && scan.cells[at + 1] === "[") return readBracketed(scan, at, true);
  if (cell === "[") return readBracketed(scan, at, false);
  if (cell === "*") return readMark(scan, at);
  return null;
}

function inlineFromCells(cells: Piece[]): InlineNode[] {
  const scan: Scan = {
    cells,
    bracket: cursorFor(cells, "]"),
    paren: cursorFor(cells, ")"),
    star: cursorFor(cells, "*"),
  };
  const nodes: InlineNode[] = [];
  let literal = "";

  /** Adjacent text is one run. A refused link contributes its label as text
   * mid-sentence, and two text nodes where the reader sees one sentence would
   * make every caller that reads `inline[0]` wrong about it. */
  const emit = (node: InlineNode): void => {
    const last = nodes[nodes.length - 1];
    if (node.kind === "text" && last !== undefined && last.kind === "text") {
      nodes[nodes.length - 1] = { kind: "text", value: last.value + node.value };
      return;
    }
    nodes.push(node);
  };

  const flush = (): void => {
    if (literal === "") return;
    for (const node of textNodes(literal)) emit(node);
    literal = "";
  };

  let index = 0;
  while (index < cells.length) {
    const cell = cells[index];
    if (typeof cell !== "string") {
      flush();
      emit(cell);
      index += 1;
      continue;
    }
    const token = readToken(scan, index);
    if (token === null) {
      literal += cell;
      index += 1;
      continue;
    }
    flush();
    for (const node of token.nodes) emit(node);
    index = token.end;
  }
  flush();
  return nodes;
}

/** The inline nodes of a run of body text. */
export function inlineFromPieces(pieces: Piece[]): InlineNode[] {
  return inlineFromCells(charactersOf(pieces));
}

/**
 * A run of inline nodes as the one block it is.
 *
 * A lone image is its own block rather than a paragraph containing one, which
 * is what keeps a figure from being nested inside a `<p>`. Derived from what
 * the run actually parsed to, so the markdown and HTML spellings of a
 * standalone image cannot disagree about it.
 */
export function blockFromInline(nodes: InlineNode[]): Block | null {
  const inline = trimInline(nodes);
  if (inline.length === 0) return null;
  const only = inline[0];
  if (inline.length === 1 && only.kind === "image") {
    return { kind: "image", src: only.src, alt: only.alt };
  }
  return { kind: "paragraph", inline };
}

/**
 * A heading, or nothing when it is the pipeline's duplicate of the post title.
 *
 * The pipeline repeats the title as a leading `# ` in a markdown body and as a
 * leading `<h1>` in an HTML one, and the page template already renders it, so
 * the duplicate is dropped rather than demoted to a visible H2 saying the
 * headline twice. One implementation for both spellings, because "exactly one
 * title can be dropped" is a fact about the document, not about its syntax.
 */
export function headingBlock(
  level: 2 | 3,
  inline: InlineNode[],
  dropWhenLeading: boolean,
  context: Context,
): Block[] {
  if (inline.length === 0) return [];
  const block: Block = { kind: "heading", level, inline };
  if (dropWhenLeading && context.leading) {
    context.leading = false;
    context.droppedTitle = block;
    return [];
  }
  return [block];
}

/* -------------------------------------------------------------------------- */
/* Blocks                                                                      */
/* -------------------------------------------------------------------------- */

// Six levels, not three. `#### Foo` matching nothing made it a paragraph whose
// text began with a literal `####`.
const HEADING = /^(#{1,6})\s+/;
// One pattern for every list item. Marker type is read per item rather than
// tested across the whole block: requiring homogeneity made `- Parent` with a
// `1. Child` match no branch at all and render as a paragraph of literal
// markers.
const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+/;
const QUOTE_LINE = /^>\s?/;
const TABLE_SEPARATOR = /^\|(\s*:?-{3,}:?\s*\|)+$/;

/** The leading text of a line, which is where every block marker has to be. A
 * line that opens with a node opens with markup, so it opens no markdown
 * block. */
function lead(line: Piece[]): string {
  const first = line[0];
  return typeof first === "string" ? first : "";
}

/** The whole line as a string, or null when it carries a node. */
function plainLine(line: Piece[]): string | null {
  let text = "";
  for (const piece of line) {
    if (typeof piece !== "string") return null;
    text += piece;
  }
  return text;
}

interface Marked {
  marker: RegExpMatchArray;
  rest: Piece[];
}

/**
 * The line with its marker taken off, or null when it carries none.
 *
 * Matched once, where the result is used: testing every line with one call and
 * then re-matching it in another is how a marker comes to be recognised by one
 * rule and stripped by a second that has drifted from it.
 */
function dropMarker(line: Piece[], pattern: RegExp): Marked | null {
  const marker = lead(line).match(pattern);
  if (marker === null) return null;
  const rest = lead(line).slice(marker[0].length);
  const tail = line.slice(1);
  return { marker, rest: rest === "" ? tail : [rest, ...tail] };
}

/** Every line's marker, or null if any line lacks one. */
function markAll(lines: Piece[][], pattern: RegExp): Marked[] | null {
  const marked: Marked[] = [];
  for (const line of lines) {
    const one = dropMarker(line, pattern);
    if (one === null) return null;
    marked.push(one);
  }
  return marked;
}

function isBlank(line: Piece[]): boolean {
  return line.every((piece) => typeof piece === "string" && piece.trim() === "");
}

/** Text and node pieces as lines, with adjacent text merged so a marker split
 * across two text nodes is still one leading string. */
function linesOf(pieces: Piece[]): Piece[][] {
  const lines: Piece[][] = [[]];
  const append = (piece: Piece): void => {
    const line = lines[lines.length - 1];
    const last = line[line.length - 1];
    if (typeof piece === "string" && typeof last === "string") {
      line[line.length - 1] = last + piece;
      return;
    }
    line.push(piece);
  };

  for (const piece of pieces) {
    if (typeof piece !== "string") {
      append(piece);
      continue;
    }
    const parts = piece.split("\n");
    parts.forEach((part, index) => {
      if (index > 0) lines.push([]);
      if (part !== "") append(part);
    });
  }
  return lines;
}

/** Blank lines separate blocks. */
function groupsOf(lines: Piece[][]): Piece[][][] {
  const groups: Piece[][][] = [];
  let current: Piece[][] = [];
  for (const line of lines) {
    if (isBlank(line)) {
      if (current.length > 0) groups.push(current);
      current = [];
      continue;
    }
    current.push(line);
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

const BLANK_CELL = /\s/;

/** One line's pieces per cell, with an escaped `|` unescaped back to a pipe. */
function rowCells(line: Piece[]): InlineNode[][] {
  const cells = charactersOf(line);
  const blank = (cell: Piece | undefined): boolean =>
    typeof cell === "string" && BLANK_CELL.test(cell);
  let start = 0;
  let end = cells.length;
  while (start < end && blank(cells[start])) start += 1;
  while (end > start && blank(cells[end - 1])) end -= 1;
  if (cells[start] === "|") start += 1;
  if (end > start && cells[end - 1] === "|") end -= 1;

  const row: InlineNode[][] = [];
  let cell: Piece[] = [];
  for (let index = start; index < end; index += 1) {
    if (cells[index] === "\\" && cells[index + 1] === "|") {
      cell.push("|");
      index += 1;
      continue;
    }
    if (cells[index] === "|") {
      row.push(trimInline(inlineFromCells(cell)));
      cell = [];
      continue;
    }
    cell.push(cells[index]);
  }
  row.push(trimInline(inlineFromCells(cell)));
  return row;
}

/**
 * One rectangle rule for every table: the widest row sets the width, and every
 * row is padded to it. Truncating to the header's width instead would silently
 * drop a cell a ragged source did carry.
 */
export function tableBlock(header: InlineNode[][], rows: InlineNode[][][]): Block | null {
  const width = rows.reduce((widest, row) => Math.max(widest, row.length), header.length);
  if (width === 0) return null;
  const pad = (row: InlineNode[][]): InlineNode[][] =>
    Array.from({ length: width }, (_, index) => row[index] ?? []);
  return {
    kind: "table",
    // A table with no header row keeps an empty one. Padding it to the table's
    // width instead would put a row of blank bordered cells above every
    // headerless table, which is the commonest shape the pipeline emits.
    header: header.length === 0 ? [] : pad(header),
    rows: rows.map(pad),
  };
}

/**
 * One group of list lines becomes one list per run of root-level marker type.
 * `- One` followed by `1. Two` is two lists in Markdown, not one, and certainly
 * not a paragraph.
 */
function listBlocks(marked: Marked[]): Block[] {
  const blocks: Block[] = [];
  let current: ListNode | null = null;

  const flush = (): void => {
    if (current === null) return;
    blocks.push({ kind: "list", ordered: current.ordered, items: current.items });
    current = null;
  };

  /** One level of nesting. A nested item with no parent is promoted to root
   * rather than dropped, so no content can vanish. */
  const nest = (list: ListNode, item: ListItem, ordered: boolean): void => {
    const parent = list.items[list.items.length - 1];
    const group = parent.children[parent.children.length - 1];
    if (group !== undefined && group.ordered === ordered) group.items.push(item);
    else parent.children.push({ ordered, items: [item] });
  };

  for (const { marker, rest } of marked) {
    const ordered = /\d/.test(marker[2]);
    const item: ListItem = { inline: trimInline(inlineFromPieces(rest)), children: [] };

    if (marker[1].length > 0 && current !== null && current.items.length > 0) {
      nest(current, item, ordered);
      continue;
    }
    if (current === null || current.ordered !== ordered) {
      flush();
      current = { ordered, items: [] };
    }
    current.items.push(item);
  }

  flush();
  return blocks;
}

function tableBlocks(lines: Piece[][]): Block[] | null {
  if (lines.length < 2) return null;
  const separator = plainLine(lines[1]);
  if (separator === null || !TABLE_SEPARATOR.test(separator.trim())) return null;
  const table = tableBlock(rowCells(lines[0]), lines.slice(2).map(rowCells));
  return table === null ? null : [table];
}

function blocksFromGroup(lines: Piece[][], context: Context): Block[] {
  const heading = lines.length === 1 ? dropMarker(lines[0], HEADING) : null;
  if (heading !== null) {
    const depth = heading.marker[1].length;
    return headingBlock(
      headingLevel(depth),
      trimInline(inlineFromPieces(heading.rest)),
      depth === 1,
      context,
    );
  }

  const quoted = markAll(lines, QUOTE_LINE);
  if (quoted !== null) {
    const kept = quoted
      .map(({ rest }) => trimInline(inlineFromPieces(rest)))
      .filter((inline) => inline.length > 0);
    if (kept.length > 0) return [{ kind: "blockquote", lines: kept }];
  }

  const items = markAll(lines, LIST_ITEM);
  if (items !== null) {
    const lists = listBlocks(items);
    if (lists.length > 0) return lists;
  }

  if (lines.every((line) => lead(line).trim().startsWith("|"))) {
    const table = tableBlocks(lines);
    if (table !== null) return table;
  }

  // Wrapped lines are one paragraph, so they join with a space.
  const joined: Piece[] = [];
  lines.forEach((line, index) => {
    if (index > 0) joined.push(SPACE);
    joined.push(...line);
  });
  const block = blockFromInline(inlineFromPieces(joined));
  return block === null ? [] : [block];
}

/** A run of body text as the blocks it spells. */
export function blocksFromPieces(pieces: Piece[], context: Context): Block[] {
  const blocks: Block[] = [];
  for (const group of groupsOf(linesOf(pieces))) {
    for (const block of blocksFromGroup(group, context)) {
      blocks.push(block);
      context.leading = false;
    }
  }
  return blocks;
}
