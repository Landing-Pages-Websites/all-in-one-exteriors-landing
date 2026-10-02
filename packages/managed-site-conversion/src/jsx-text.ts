import ts from "typescript";

import type {
  ManagedRichTextBlock,
  ManagedRichTextDocument,
} from "@landing-pages-websites/managed-site-contract";

import { isFormattedBlock, readInlineBlock, type InlineContext } from "./inline-block.js";
import {
  childrenOf,
  isElementChild,
  jsxExpressionStringValue,
  normaliseJsxText,
  type JsxElementNode,
} from "./jsx-facts.js";

export interface ChildPartition {
  readonly children: readonly ts.JsxChild[];
  /** Direct text of this element only. */
  readonly textRun: string;
  /** Text of this element and its descendants, for link labels. */
  readonly allText: string;
  readonly elementChildren: readonly JsxElementNode[];
  readonly expressionChildren: readonly ts.JsxExpression[];
  /**
   * Whether the children make the element ONE formatted block (see
   * `isFormattedBlock`), read as one rich-text value rather than per run.
   */
  readonly formatted: boolean;
  /**
   * Whether the direct text arrives in more than one piece.
   *
   * `textRun` JOINS every text child, so `<p>© {legal} All rights reserved.</p>`
   * yields one string standing for text at two positions with a computed value
   * between them. Nothing can write that back: the editor applies an edit with
   * `element.textContent = text`, which would replace the computed value too.
   * A reader that proposes a field has to know the difference.
   */
  readonly textIsSplit: boolean;
}

function directTextOf(child: ts.JsxChild): string | null {
  if (ts.isJsxText(child)) return normaliseJsxText(child.text);
  if (ts.isJsxExpression(child)) return jsxExpressionStringValue(child);
  return null;
}

function descendantTextOf(child: ts.JsxChild): string {
  const direct = directTextOf(child);
  if (direct !== null) return direct;
  if (!isElementChild(child)) return "";
  return childrenOf(child).map(descendantTextOf).join("");
}

/**
 * `textBlock` says whether the element's content is one run of text by nature
 * (a heading, paragraph, button, link label), which decides whether inline
 * children with no bare text between them still read as one formatted block.
 */
export function partitionChildren(
  textBlock: boolean,
  children: readonly ts.JsxChild[],
): ChildPartition {
  const elementChildren = children.filter(isElementChild);
  const expressionChildren = children.filter(
    (child): child is ts.JsxExpression =>
      ts.isJsxExpression(child) && jsxExpressionStringValue(child) === null,
  );
  const textRun = children.map((child) => directTextOf(child) ?? "").join("");
  const textPieces = children.filter(
    (child) => (directTextOf(child) ?? "").trim().length > 0,
  ).length;
  const allText = children.map(descendantTextOf).join("");
  return {
    children,
    textRun: textRun.trim(),
    allText: allText.replace(/\s+/gu, " ").trim(),
    elementChildren,
    expressionChildren,
    formatted: isFormattedBlock(textBlock, children),
    textIsSplit: textPieces > 1,
  };
}

/**
 * Builds one rich-text document from a `<ul>` or `<ol>` of static items.
 *
 * Items written out as siblings have nothing to tell them apart (no id, no
 * name, only their order, which `anchors.ts` refuses as identity), so as
 * separate values they are unnameable; as ONE list they need no item identity
 * at all, and the contract already models `bullet_list` and `ordered_list`.
 *
 * Each item is read exactly as a formatted block is, so a mark means the same
 * thing in a list as in a paragraph. Returns null whenever an item is not a
 * plain `<li>` of inline text: a computed child, a nested list, a link, a line
 * break or anything that maps to no mark, each of which falls back to the ordinary walk
 * rather than flattening into prose.
 */
export function buildRichTextListDocument(
  element: JsxElementNode,
  ordered: boolean,
  context: Omit<InlineContext, "allowLinks">,
): ManagedRichTextDocument | null {
  type ListItem = Extract<ManagedRichTextBlock, { type: "bullet_list" }>["content"][number];
  const items: ListItem[] = [];
  for (const child of childrenOf(element)) {
    if (ts.isJsxText(child)) {
      // The indentation between `<li>` siblings. Real text between items still
      // refuses, because it would be dropped from the document.
      if (child.text.trim() !== "") return null;
      continue;
    }
    if (!ts.isJsxElement(child)) return null;
    if (child.openingElement.tagName.getText() !== "li") return null;
    const reading = readInlineBlock(child, childrenOf(child), { ...context, allowLinks: false });
    if (reading.kind !== "block") return null;
    // A list document is never rendered in place, so a <br> in an item would
    // reach the page as a plain break without the source's class. Such a list
    // keeps the ordinary walk it had before breaks were nodes.
    if (reading.inlines.some((inline) => inline.type === "hard_break")) return null;
    items.push({ type: "list_item", content: [{ type: "paragraph", content: reading.inlines }] });
  }
  if (items.length === 0) return null;
  return {
    type: "doc",
    content: [{ type: ordered ? "ordered_list" : "bullet_list", content: items }],
  };
}
