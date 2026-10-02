/**
 * A post body to a block AST.
 *
 * This module is the contract and the entry point. The block kinds below are
 * what the MEGA go-live blog migrator targets: the migrator must never emit a
 * construct that is not in `BlockKind`, or it renders as literal markdown on a
 * live customer site.
 *
 * The pipeline publishes two body shapes, markdown and raw HTML, and some
 * bodies are both. There is no routing decision between them. Every body is
 * scanned as HTML first (`html-tokens.ts`), its blocks come from the tag
 * structure that scan found (`html-blocks.ts`), and the markdown grammar
 * (`markdown-text.ts`) runs on the text between the tags — never on a tag, and
 * never on anything it could turn back into one. A body with no tags in it is
 * one text node, which is the degenerate case and costs nothing.
 *
 * Kept a pure module: it is testable under `tsx --test` where a TSX component
 * is not.
 */

import { inlineFromBody, parseHtmlBody } from "./html-blocks";

export type { InlineNode } from "./inline";

import type { InlineNode } from "./inline";

export interface ListNode {
  ordered: boolean;
  items: ListItem[];
}

export interface ListItem {
  inline: InlineNode[];
  /**
   * Nested lists, one group per run of the same marker type.
   * `- Parent` with a `- a` then a `1. b` child is two groups, because the
   * marker is a property of the item that carries it, not of the list.
   */
  children: ListNode[];
}

export type Block =
  | { kind: "heading"; level: 2 | 3; inline: InlineNode[] }
  | { kind: "paragraph"; inline: InlineNode[] }
  | { kind: "list"; ordered: boolean; items: ListItem[] }
  | { kind: "blockquote"; lines: InlineNode[][] }
  | { kind: "table"; header: InlineNode[][]; rows: InlineNode[][][] }
  | { kind: "code"; text: string }
  | { kind: "image"; src: string; alt: string };

export type BlockKind = Block["kind"];

/** Every kind the parser can emit. The migrator's output must stay inside it. */
export const BLOCK_KINDS: readonly BlockKind[] = [
  "heading",
  "paragraph",
  "list",
  "blockquote",
  "table",
  "code",
  "image",
] as const;

/** The inline nodes of a body fragment. */
export function parseInline(source: string): InlineNode[] {
  return inlineFromBody(source);
}

/** A published body as blocks. */
export function parseBlocks(source: string): Block[] {
  return parseHtmlBody(source ?? "");
}
