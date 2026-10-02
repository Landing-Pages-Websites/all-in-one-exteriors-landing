/**
 * A post body to a tree of elements, text and verbatim regions. The byte-level
 * layer, and nothing above it: it knows tag syntax, entities, which tags nest,
 * and where content stops being markup, and it knows nothing about Blocks.
 *
 * It runs over every body unconditionally. Deciding first whether a body "is
 * HTML" would mean answering, from line shapes, a question this layer answers
 * from the bytes; a body with no tags in it simply scans to one text node.
 *
 * Bounded on purpose. The input is our own content pipeline's output over the
 * ~30 tags in `html-tags.ts`, not arbitrary web HTML, and `src/` here
 * propagates to roughly 276 customer sites, so a runtime dependency for a
 * build-time concern is 276 lockfile changes and a supply-chain surface.
 *
 * Two properties everything above it relies on:
 *
 *  - **No dropped element reaches the tree.** `<script>`, `<style>`,
 *    `<template>` and `<noscript>` are skipped whole, content included, and
 *    `buildTree` refuses to attach one even if the scanner ever emitted it.
 *    Raw-text content (JSON-LD, CSS, minified JS) is therefore never tokenized
 *    as markup at all.
 *  - **Verbatim beats markup.** A fenced block or a code span is lexed before
 *    any tag inside it can be, because inside one nothing is a tag. The
 *    ordering is stated once, here, so no layer above has to hold a construct
 *    out of this one's way and put it back afterwards.
 *  - **Malformed input is bounded, never unbounded.** An unterminated quote, an
 *    unclosed tag and a stray close tag each cost their own construct and
 *    nothing after it. The one deliberate exception is an unterminated dropped
 *    element, which drops the rest of the document: leaking raw JavaScript at
 *    the reader is worse than losing the tail.
 *
 * Its adversarial corpus is `html-tokens.test.ts`, which is where anything
 * about what a byte sequence MEANS belongs.
 */

import {
  CLOSED_BY,
  DROPPED_TAGS,
  RAW_TEXT_TAGS,
  VOID_TAGS,
  lookup,
  roleFor,
} from "./html-tags";

/* -------------------------------------------------------------------------- */
/* Entities                                                                    */
/* -------------------------------------------------------------------------- */

const NAMED_ENTITIES: Readonly<Record<string, string>> = lookup<string>({
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  bull: "•",
  middot: "·",
  deg: "°",
  copy: "©",
  reg: "®",
  trade: "™",
  times: "×",
  frac12: "½",
  laquo: "«",
  raquo: "»",
});

// Bounded on both sides, so it cannot backtrack across a long body.
const ENTITY = /&(#[xX][0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-zA-Z][a-zA-Z0-9]{1,31});/g;

/**
 * One pass, so `&amp;lt;` decodes to the text `&lt;` rather than to `<`.
 * An entity this table does not know is left verbatim: that is what a browser
 * would show, and inventing a character would be worse than leaving one.
 */
export function decodeEntities(text: string): string {
  if (!text.includes("&")) return text;
  return text.replace(ENTITY, (match, body: string) => {
    if (body.startsWith("#")) {
      const code =
        body[1] === "x" || body[1] === "X"
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return match;
      // A lone surrogate is not a character, so it is left as the literal
      // entity text. Nothing else is refused: no character is special to the
      // parser any more, because a node's place is held by a list entry rather
      // than by a character a body could spell.
      if (code >= 0xd800 && code <= 0xdfff) return match;
      try {
        return String.fromCodePoint(code);
      } catch {
        return match;
      }
    }
    return NAMED_ENTITIES[body] ?? match;
  });
}

const WHITESPACE_RUN = /\s+/g;

/**
 * A run of source text as the characters a reader sees.
 *
 * Whitespace collapses the way HTML collapses it, and entities decode after,
 * so a decoded `&nbsp;` survives the collapse rather than being folded into the
 * space beside it. Stated here, once, because both the tag walker and the
 * markdown grammar turn source into text and neither may do it differently.
 */
export function collapseAndDecode(value: string): string {
  return decodeEntities(value.replace(WHITESPACE_RUN, " "));
}

/* -------------------------------------------------------------------------- */
/* Tokenizer                                                                   */
/* -------------------------------------------------------------------------- */

export type Token =
  | { type: "text"; value: string }
  /**
   * A region whose content is not markup, because inside one nothing is: a
   * fenced block or a code span. Lexed here, ahead of every tag, which is the
   * one place the ordering can be stated once — a `<div>` inside a code span is
   * displayed content, and a backtick inside an attribute value or a `<script>`
   * is not a delimiter.
   */
  | { type: "verbatim"; block: boolean; text: string; source: string }
  | { type: "open"; tag: string; attrs: Record<string, string>; selfClosing: boolean }
  | { type: "close"; tag: string };

const NAME_START = /[a-zA-Z]/;
const NAME_CHAR = /[a-zA-Z0-9:_.-]/;
const SPACE = /\s/;
const SPACE_OR_GT = /[\s>]/;

function readName(html: string, at: number): { name: string; end: number } | null {
  if (!NAME_START.test(html[at] ?? "")) return null;
  let end = at + 1;
  while (end < html.length && NAME_CHAR.test(html[end])) end += 1;
  return { name: html.slice(at, end).toLowerCase(), end };
}

/**
 * Read a start tag's attributes. Quoted values are read to their closing
 * quote, so an attribute containing `>` (`<p title="a > b">`) does not end the
 * tag early and spill the rest of it into the page as text.
 */
/**
 * Where an unterminated attribute value has to stop: the next `<`.
 *
 * Not the next `>`. A quoted value legitimately contains one
 * (`<p title="a > b">`), and stopping there is what would spill the rest of the
 * tag onto the page. A `<` inside a value is a typo either way, so it is the
 * boundary that costs nothing when the quote WAS terminated and saves the
 * document when it was not.
 */
function boundedValueEnd(html: string, from: number): number {
  const next = html.indexOf("<", from);
  return next === -1 ? html.length : next;
}

function readAttributes(
  html: string,
  from: number,
): { attrs: Record<string, string>; selfClosing: boolean; end: number } {
  const attrs: Record<string, string> = {};
  let index = from;
  let selfClosing = false;
  while (index < html.length) {
    while (index < html.length && SPACE.test(html[index])) index += 1;
    if (index >= html.length) break;
    if (html[index] === ">") {
      index += 1;
      break;
    }
    // A `<` inside a start tag means the tag was never closed. Ending it here
    // keeps the next tag readable instead of eating it as an attribute name.
    if (html[index] === "<") break;
    if (html[index] === "/") {
      selfClosing = true;
      index += 1;
      continue;
    }
    const name = readName(html, index);
    if (name === null) {
      index += 1;
      continue;
    }
    index = name.end;
    while (index < html.length && SPACE.test(html[index])) index += 1;
    if (html[index] !== "=") {
      attrs[name.name] = "";
      continue;
    }
    index += 1;
    while (index < html.length && SPACE.test(html[index])) index += 1;
    const quote = html[index];
    if (quote === '"' || quote === "'") {
      // A quoted value runs to its closing quote, `<` and `>` included: that is
      // what a browser does, and `title="</template>"` really is a string.
      // Only when there is NO closing quote at all is the value bounded, so an
      // unterminated one costs its own tag rather than the rest of the article.
      const close = html.indexOf(quote, index + 1);
      const end = close === -1 ? boundedValueEnd(html, index + 1) : close;
      attrs[name.name] = decodeEntities(html.slice(index + 1, end));
      index = close === -1 ? end : end + 1;
      continue;
    }
    let end = index;
    while (end < html.length && !SPACE_OR_GT.test(html[end])) end += 1;
    attrs[name.name] = decodeEntities(html.slice(index, end));
    index = end;
  }
  return { attrs, selfClosing, end: index };
}

/**
 * The one place that answers "what markup construct starts at this `<`, and
 * where does it end". Every walker in this module goes through it.
 *
 * Answering that question a second way is how tag-shaped text inside a quoted
 * attribute keeps being mistaken for a tag. A walker that steps forward one
 * character at a time past a start tag will meet `<script>` inside
 * `title="<script>"` and believe it; one that steps past the whole construct
 * cannot.
 */
type Construct =
  | { kind: "comment"; end: number }
  | { kind: "declaration"; end: number }
  | { kind: "close"; name: string; end: number }
  | {
      kind: "open";
      name: string;
      attrs: Record<string, string>;
      selfClosing: boolean;
      end: number;
    };

function readConstruct(html: string, at: number): Construct | null {
  if (html.startsWith("<!--", at)) {
    const close = html.indexOf("-->", at + 4);
    return { kind: "comment", end: close === -1 ? html.length : close + 3 };
  }
  if (html[at + 1] === "!" || html[at + 1] === "?") {
    const gt = html.indexOf(">", at);
    return { kind: "declaration", end: gt === -1 ? html.length : gt + 1 };
  }
  const closing = html[at + 1] === "/";
  const name = readName(html, closing ? at + 2 : at + 1);
  // A `<` that opens no tag is literal text ("5 < 6").
  if (name === null) return null;
  if (closing) {
    const gt = html.indexOf(">", name.end);
    return { kind: "close", name: name.name, end: gt === -1 ? html.length : gt + 1 };
  }
  const { attrs, selfClosing, end } = readAttributes(html, name.end);
  return { kind: "open", name: name.name, attrs, selfClosing, end };
}

/**
 * Index just past the matching close tag, or the end of the document.
 *
 * Two different jobs, because the two kinds of dropped element hold two
 * different kinds of content:
 *
 * `script` and `style` hold RAW TEXT. `</script` inside a JS string really does
 * end the element, exactly as it does in a browser, so a scan for the name with
 * a boundary after it (`</scriptfoo>` does not count) is both correct and
 * enough.
 *
 * `template` and `noscript` hold real markup, so they nest and their tags carry
 * real attributes. Depth is counted, and every start tag is read with the same
 * quote-aware attribute reader the tokenizer uses, so a `</template>` sitting
 * inside `title="…"` is a string and not a close tag. A nested dropped element
 * is skipped whole on the way through, so a `</template>` inside a `<script>`
 * inside a `<template>` cannot end the outer one either.
 *
 * An unterminated one drops the rest of the document, which is the fail-closed
 * direction for rule 1: leaking raw JavaScript at the reader is worse than
 * losing the tail.
 */
/** The first blank line at or after `from`, or the end of the document. A blank
 * line is where one block stops and the next begins. */
function blankLineAfter(html: string, from: number): number {
  let newline = html.indexOf("\n", from);
  while (newline !== -1) {
    let index = newline + 1;
    while (html[index] === " " || html[index] === "\t") index += 1;
    if (html[index] === "\n") return newline;
    newline = html.indexOf("\n", index);
  }
  return html.length;
}

interface Skipped {
  end: number;
  /** Whether a real close tag was found. An unterminated element has no
   * established content: everything after its opener was never inside it. */
  terminated: boolean;
}

function skipRawText(html: string, from: number, tag: string, limit: number): Skipped {
  const scanner = new RegExp(`</${tag}(?![a-zA-Z0-9:_.-])`, "gi");
  scanner.lastIndex = from;
  const match = scanner.exec(html);
  if (match === null || match.index >= limit) return { end: limit, terminated: false };
  const gt = html.indexOf(">", match.index);
  return gt === -1 ? { end: limit, terminated: false } : { end: gt + 1, terminated: true };
}

/**
 * Where a dropped element's content ends, looking no further than `limit`.
 *
 * The limit is the whole document for the tokenizer, because rule 1 is a
 * document-wide rule. It is one block for the code-span probe, because whether
 * `` `<script>` `` is prose about a tag must not depend on a `</script>` in
 * some other paragraph — an inline construct is decided inside its own block.
 */
function skipDropped(html: string, from: number, tag: string, limit: number): Skipped {
  if (RAW_TEXT_TAGS.has(tag)) return skipRawText(html, from, tag, limit);

  let index = from;
  let depth = 1;
  while (index < limit) {
    const lt = html.indexOf("<", index);
    if (lt === -1) break;
    const construct = readConstruct(html, lt);
    if (construct === null) {
      index = lt + 1;
      continue;
    }
    if (construct.kind === "close" && construct.name === tag) {
      depth -= 1;
      if (depth === 0) return { end: construct.end, terminated: true };
    } else if (construct.kind === "open") {
      if (construct.name === tag) {
        if (!construct.selfClosing) depth += 1;
      } else if (DROPPED_TAGS.has(construct.name)) {
        // Skipped whole, so its raw text cannot be mistaken for this one's
        // close tag.
        index = skipDropped(html, construct.end, construct.name, limit).end;
        continue;
      }
    }
    index = construct.end;
  }
  return { end: limit, terminated: false };
}

function skipDroppedContent(html: string, from: number, tag: string): number {
  return skipDropped(html, from, tag, html.length).end;
}

/* -------------------------------------------------------------------------- */
/* Verbatim regions                                                            */
/* -------------------------------------------------------------------------- */

const FENCE = "```";

/** Whether only spaces and tabs separate `at` from the start of its line. */
function opensALine(html: string, at: number): boolean {
  let index = at - 1;
  while (index >= 0 && (html[index] === " " || html[index] === "\t")) index -= 1;
  return index < 0 || html[index] === "\n";
}

interface Verbatim {
  block: boolean;
  /** The region's content, without its delimiters. */
  text: string;
  /** Exactly the characters the region was lexed from, delimiters included.
   * Kept rather than rebuilt: a fence's opening line carries an info string and
   * may be indented, and anything reconstructed from `text` alone has to guess
   * both. Nothing guesses, so nothing can guess wrong. */
  source: string;
  end: number;
}

/**
 * The first `character` at or after `from` that is in TEXT position: outside
 * every markup construct, and outside every dropped element's content.
 *
 * A verbatim region opens in text, because the scanner only offers a delimiter
 * as an opener when it precedes the next `<`. Its CLOSER has to be held to the
 * same standard or the region can end somewhere that was never text and swallow
 * whatever stood between: a backtick inside `title="x`">` would otherwise close
 * a span that began in prose, eating the `<script>` opener it sat in and leaving
 * that element's payload on the page as ordinary words.
 *
 * A region may still CONTAIN a construct — `` `<div>` `` is a code span whose
 * content is a tag, which is the whole point — so constructs are stepped over
 * rather than treated as boundaries. Stepping is done with `readConstruct` and
 * `skipDropped`, the same two functions the tokenizer itself walks with, so
 * there is one answer to "where is a tag" and not a second approximate one.
 *
 * `mayHoldDropped` is what separates the two callers. A fence is an author
 * instruction, written on its own line, to display the lines that follow as
 * source: a `<script>` sample inside one is the feature. A code span is an
 * inline literal, and a whole terminated `<script>…</script>` inside one is
 * never prose — it is two backticks that happened to pair across markup — so
 * there the region is refused and rule 1 removes the element as usual.
 */
function indexOfInText(
  html: string,
  character: string,
  from: number,
  mayHoldDropped: boolean,
  limit: number,
): number {
  let index = from;
  // Both cached, for the same reason `tokenize` caches them: `index` only moves
  // forward, so a remembered position at or after it is still the next one.
  // Searching afresh each pass would rescan the tail once per construct, which
  // is quadratic on a span that closes past many tags.
  let next = html.indexOf(character, from);
  let lt = html.indexOf("<", from);
  while (index < limit) {
    if (next !== -1 && next < index) next = html.indexOf(character, index);
    if (next === -1 || next >= limit) return -1;
    if (lt !== -1 && lt < index) lt = html.indexOf("<", index);
    if (lt === -1 || next < lt) return next;
    const construct = readConstruct(html, lt);
    if (construct === null) {
      // A `<` that opens no tag is literal text ("5 < 6").
      index = lt + 1;
      continue;
    }
    if (
      construct.kind !== "open" ||
      !DROPPED_TAGS.has(construct.name) ||
      VOID_TAGS.has(construct.name)
    ) {
      index = construct.end;
      continue;
    }
    const skipped = skipDropped(html, construct.end, construct.name, limit);
    // An UNTERMINATED dropped element has no established content — nothing
    // after its opener was ever inside it — so only the opener's own inert
    // source is stepped over, which is what keeps `` `<script>` `` in prose
    // reading as prose about a tag.
    if (!skipped.terminated) {
      index = construct.end;
      continue;
    }
    // A TERMINATED one has content, and a delimiter inside it was never text:
    // rule 1 would have removed it.
    if (!mayHoldDropped) return -1;
    index = skipped.end;
  }
  return -1;
}

/**
 * The verbatim region starting at a backtick, or null if that backtick is
 * ordinary text. A fence must open a line, which is what keeps it from being
 * confused with prose.
 */
/** A fenced block. The rest of the opening line is the language tag, which is
 * accepted and ignored, and an unterminated fence runs to the end of the body
 * rather than silently swallowing nothing. */
function readFence(html: string, at: number): Verbatim {
  const opened = html.indexOf("\n", at);
  if (opened === -1) {
    return { block: true, text: "", source: html.slice(at), end: html.length };
  }
  const from = opened + 1;
  let index = from;
  // The closing fence has to open a line AND be in text position, for the same
  // reason a code span's closing backtick does: a `` ``` `` sitting inside an
  // attribute value never was a line of this document.
  while (index < html.length) {
    const tick = indexOfInText(html, "`", index, true, html.length);
    if (tick === -1) break;
    if (html.startsWith(FENCE, tick) && opensALine(html, tick)) {
      const newline = html.indexOf("\n", tick);
      const end = newline === -1 ? html.length : newline + 1;
      return {
        block: true,
        // Cut at the closing fence LINE, indentation included.
        text: html.slice(from, tick).replace(/\n[ \t]*$/, ""),
        source: html.slice(at, end),
        end,
      };
    }
    index = tick + 1;
  }
  return { block: true, text: html.slice(from), source: html.slice(at), end: html.length };
}

/**
 * A code span, resolved entirely inside its own block.
 *
 * It needs a closing backtick with at least one character between — a lone
 * backtick is punctuation — and `blockEnd` is where its block stops. A code span
 * is INLINE: it cannot leave the block it opened in, exactly as it cannot in
 * CommonMark. Without that bound one unpaired backtick in a paragraph reaches
 * forward to the next backtick anywhere in the document and swallows every tag
 * in between, so a stray character costs the structure of everything after it —
 * and whether `` `<script>` `` reads as prose would depend on a `</script>` in
 * some unrelated paragraph.
 *
 * A fence has no such bound, because a fence IS a block and blank lines are its
 * content.
 */
function readCodeSpan(html: string, at: number, blockEnd: number): Verbatim | null {
  const close = indexOfInText(html, "`", at + 1, false, blockEnd);
  if (close === -1 || close === at + 1) return null;
  return {
    block: false,
    text: html.slice(at + 1, close),
    source: html.slice(at, close + 1),
    end: close + 1,
  };
}

function readVerbatim(html: string, at: number, blockEnd: number): Verbatim | null {
  return html.startsWith(FENCE, at) && opensALine(html, at)
    ? readFence(html, at)
    : readCodeSpan(html, at, blockEnd);
}

/* -------------------------------------------------------------------------- */
/* Scanning                                                                    */
/* -------------------------------------------------------------------------- */

const LINE_ENDINGS = /\r\n?/g;

/**
 * CRLF and lone CR become LF, once, before anything reads a line.
 *
 * This is the HTML spec's own input preprocessing, and it is why nothing below
 * has to spell `\r`. A blank line, a fence's own line, the indentation before a
 * closing fence and a paragraph break are each decided against ONE line ending
 * rather than each site being taught the other two — nine places in this parser
 * look for a newline, and a body pasted out of Windows-authored HTML would
 * otherwise have to be right in all nine.
 */
function normalizeLines(source: string): string {
  return source.includes("\r") ? source.replace(LINE_ENDINGS, "\n") : source;
}

export function tokenize(source: string): Token[] {
  const html = normalizeLines(source);
  const tokens: Token[] = [];
  // Named `textStart` rather than `textFrom`, which is the module function that
  // turns a text run into inline nodes.
  let textStart = 0;
  let index = 0;
  // Both cached rather than searched afresh each pass. `index` only ever moves
  // forward, so a remembered position at or after it is still the next one, and
  // a body with no backticks would otherwise rescan its whole tail once per tag.
  let tick = html.indexOf("`");
  let lt = html.indexOf("<");
  // `<pre>` content is already verbatim, so lexing verbatim regions inside it
  // buys nothing and costs something: an unterminated fence there runs to the
  // end of the body and takes the `</pre>` with it, which loses the element and
  // everything after it. Tracked as a depth rather than a flag, because a `pre`
  // inside a `pre` is malformed but must still close exactly once.
  let preDepth = 0;
  // Where the current block ends, for the inline constructs that may not leave
  // it. Monotone like the other two, so the document is scanned for blank lines
  // once rather than once per backtick.
  let blank = blankLineAfter(html, 0);

  const flushText = (until: number): void => {
    if (until > textStart) tokens.push({ type: "text", value: html.slice(textStart, until) });
  };

  while (index < html.length) {
    if (lt !== -1 && lt < index) lt = html.indexOf("<", index);
    if (tick !== -1 && tick < index) tick = html.indexOf("`", index);
    if (tick !== -1 && (lt === -1 || tick < lt)) {
      if (blank !== html.length && blank < tick) blank = blankLineAfter(html, tick);
      const verbatim = preDepth > 0 ? null : readVerbatim(html, tick, blank);
      if (verbatim === null) {
        // A lone backtick is punctuation, and stays in the text run it is in.
        tick = html.indexOf("`", tick + 1);
        continue;
      }
      flushText(tick);
      tokens.push({
        type: "verbatim",
        block: verbatim.block,
        text: verbatim.text,
        source: verbatim.source,
      });
      index = verbatim.end;
      textStart = index;
      continue;
    }
    if (lt === -1) break;
    const construct = readConstruct(html, lt);
    if (construct === null) {
      // A bare `<` that opens no tag is literal text ("5 < 6").
      index = lt + 1;
      continue;
    }
    flushText(lt);
    switch (construct.kind) {
      // Comments and declarations carry no renderable content.
      case "comment":
      case "declaration":
        index = construct.end;
        break;
      case "close":
        if (construct.name === "pre" && preDepth > 0) preDepth -= 1;
        tokens.push({ type: "close", tag: construct.name });
        index = construct.end;
        break;
      default: {
        const dropped = DROPPED_TAGS.has(construct.name);
        if (construct.name === "pre" && !dropped && !construct.selfClosing) preDepth += 1;
        tokens.push({
          type: "open",
          tag: construct.name,
          attrs: construct.attrs,
          // A dropped element's `selfClosing` is forced:
          // `<script/>alert(1)</script>` is not a self-closing script to any
          // HTML parser, and honouring the slash would spill its content into
          // the page as text.
          selfClosing: dropped || construct.selfClosing,
        });
        // The token is emitted; for a dropped element its content is not. The
        // token marks where the element was and `buildTree` refuses to attach
        // it, so no walker above can reach either.
        index =
          dropped && !VOID_TAGS.has(construct.name)
            ? skipDroppedContent(html, construct.end, construct.name)
            : construct.end;
        break;
      }
    }
    textStart = index;
  }

  flushText(html.length);
  return tokens;
}

/* -------------------------------------------------------------------------- */
/* Tree                                                                        */
/* -------------------------------------------------------------------------- */

export interface ElementNode {
  type: "element";
  tag: string;
  attrs: Record<string, string>;
  children: HtmlNode[];
}

export interface TextNode {
  type: "text";
  value: string;
}

/** A fenced block or a code span. Its text is content, never markup. */
export interface VerbatimNode {
  type: "verbatim";
  block: boolean;
  text: string;
  /** Exactly what was lexed, delimiters included. See `verbatimSource`. */
  source: string;
}

export type HtmlNode = ElementNode | TextNode | VerbatimNode;

/**
 * The source a verbatim region was written as.
 *
 * Its delimiters are markup to the markdown grammar and ordinary characters to
 * anything reading raw text — inside a `<pre>`, a backtick is a backtick, and a
 * fence line keeps its info string and its indentation. Carried from the scan
 * rather than rebuilt from the content, because a rebuild has to re-invent
 * everything the delimiters said and silently loses whatever it does not model.
 */
export function verbatimSource(node: VerbatimNode): string {
  return node.source;
}

export function buildTree(tokens: Token[]): ElementNode {
  const root: ElementNode = { type: "element", tag: "#root", attrs: {}, children: [] };
  const stack: ElementNode[] = [root];

  for (const token of tokens) {
    const parent = stack[stack.length - 1];
    if (token.type === "text") {
      parent.children.push({ type: "text", value: token.value });
      continue;
    }
    if (token.type === "verbatim") {
      parent.children.push({
        type: "verbatim",
        block: token.block,
        text: token.text,
        source: token.source,
      });
      continue;
    }
    if (token.type === "close") {
      for (let depth = stack.length - 1; depth > 0; depth -= 1) {
        if (stack[depth].tag === token.tag) {
          stack.length = depth;
          break;
        }
      }
      // A close tag matching nothing open is discarded, not rendered.
      continue;
    }
    while (stack.length > 1 && CLOSED_BY[stack[stack.length - 1].tag]?.has(token.tag)) {
      stack.pop();
    }
    const node: ElementNode = {
      type: "element",
      tag: token.tag,
      attrs: token.attrs,
      children: [],
    };
    // Rule 1 is enforced here, once, for every walker downstream: a dropped
    // element is never attached to its parent, so no tree the block and inline
    // walkers see can contain one or its content. The tokenizer skips these
    // too, which is what keeps raw-text content (JSON-LD, CSS) from being
    // tokenized as markup at all; this is the guarantee, that is the fast path.
    const dropped = roleFor(token.tag).flow === "drop";
    if (!dropped) stack[stack.length - 1].children.push(node);
    // A dropped element opens no scope either: its content was never tokenized,
    // so pushing it would adopt the siblings that follow it.
    if (!dropped && !token.selfClosing && !VOID_TAGS.has(token.tag)) stack.push(node);
  }

  return root;
}
