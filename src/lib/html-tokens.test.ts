import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildTree,
  decodeEntities,
  tokenize,
  verbatimSource,
  type HtmlNode,
} from "./html-tokens.ts";

/**
 * The scanner's adversarial corpus.
 *
 * Everything above this layer is about what a tag MEANS; this file is about
 * what a byte sequence IS, which is where every high-severity defect in this
 * module has landed. The dimensions it walks, in order: name boundaries, inert
 * markup, attribute delimiters and effective value, structural position, and
 * malformed input staying bounded. The positive rows at the bottom are taken
 * from what the committed fixtures actually contain, not from invented shapes.
 */

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__/blog-bodies");

/** Flattened text of a tree, which is everything a reader could end up seeing. */
function textOf(node: HtmlNode): string {
  if (node.type === "text") return node.value;
  if (node.type === "verbatim") return node.text;
  return node.children.map(textOf).join("");
}

function treeText(html: string): string {
  return textOf(buildTree(tokenize(html)));
}

/** Every tag name the scanner decided was a tag, in document order. */
function tags(html: string): string[] {
  return tokenize(html).flatMap((token) =>
    token.type === "open" ? [token.tag] : token.type === "close" ? [`/${token.tag}`] : [],
  );
}

function attrs(html: string): Record<string, string> {
  const token = tokenize(html).find((candidate) => candidate.type === "open");
  assert.ok(token !== undefined && token.type === "open", `no start tag in ${html}`);
  return token.type === "open" ? token.attrs : {};
}

/* -------------------------------------------------------------------------- */
/* Name boundaries: `-` and letters continue a name, so `\b` is not a boundary  */
/* -------------------------------------------------------------------------- */

test("a tag name ends where a name character ends, not where a prefix matches", () => {
  const table: [string, string[]][] = [
    ["<script-x>a</script-x>", ["script-x", "/script-x"]],
    // `</scripture>` must not close a `<script>`, and `<script>` swallows to
    // its own real close tag.
    // The token marks WHERE the script was; its content is never tokenized.
    ["<script>var s = 1;</scripture>still script</script>after", ["script"]],
    ["<p>a</p>", ["p", "/p"]],
    ["<pre>a</pre>", ["pre", "/pre"]],
    // `<p>` is not the start of `<param>`.
    ["<param><p>x</p>", ["param", "p", "/p"]],
    ["<b>x</b><br>", ["b", "/b", "br"]],
    ["<H2>Head</H2>", ["h2", "/h2"]],
    ["<TaBlE><TR><TD>a", ["table", "tr", "td"]],
    // Not a tag at all: no name character follows the `<`.
    ["5 < 6 and 7 > 3", []],
    ["a <1st> b", []],
    ["a <-b> c", []],
    ["</>", []],
  ];
  for (const [html, expected] of table) {
    assert.deepEqual(tags(html), expected, html);
  }
  assert.equal(treeText("<script>var s = 1;</scripture>still script</script>after"), "after");
});

/* -------------------------------------------------------------------------- */
/* Inert markup: content that must never reach the reader                      */
/* -------------------------------------------------------------------------- */

test("inert markup is dropped whole, content included", () => {
  const table: [string, string][] = [
    ["<p>a</p><script>alert(1)</script><p>b</p>", "ab"],
    ['<script type="application/ld+json">{"@type":"Article"}</script>keep', "keep"],
    // Raw text: markup inside a script is not markup.
    ["<script>if (a < b) { document.write('<p>x</p>'); }</script>keep", "keep"],
    ["<style>p::after{content:'<b>'}</style>keep", "keep"],
    ["<template><p>hidden</p></template>keep", "keep"],
    // `template` and `noscript` really nest, so the first close cannot end them.
    ["<template><template></template>LEAK</template>keep", "keep"],
    ["<noscript><noscript></noscript>LEAK</noscript>keep", "keep"],
    ["<!-- <p>commented out</p> -->keep", "keep"],
    ["<!-- unterminated comment keep", ""],
    ["<!DOCTYPE html>keep", "keep"],
    ["<?xml version=\"1.0\"?>keep", "keep"],
    // Fail closed: an unterminated dropped element takes the rest with it
    // rather than printing raw JavaScript at the reader.
    ["<p>a</p><script>never closed<p>b</p>", "a"],
    ["<SCRIPT>alert(1)</SCRIPT>keep", "keep"],
    ["<script >alert(1)</script >keep", "keep"],
    // A dropped-tag SPELLING inside an ordinary tag's attribute is a string.
    // Believing it, and then finding no close tag, used to delete the article.
    ['<p title="<script>">visible</p>keep', "visiblekeep"],
    ['<p title="<template>">visible</p>keep', "visiblekeep"],
    ['<p title="<!-- x -->">visible</p>keep', "visiblekeep"],
    ["<p title='<style>'>visible</p>keep", "visiblekeep"],
    ['<a href="/x?a=<script>">visible</a>keep', "visiblekeep"],
    // `<script/>` is not self-closing to any HTML parser.
    ["<script/>alert(1)</script>keep", "keep"],
    ["<template/>hidden</template>keep", "keep"],
  ];
  for (const [html, expected] of table) {
    assert.equal(treeText(html).trim(), expected, html);
  }
});

/* -------------------------------------------------------------------------- */
/* Attributes: delimiters, effective value, and `>` inside a value             */
/* -------------------------------------------------------------------------- */

test("attribute values are read to their real end", () => {
  assert.deepEqual(attrs('<p title="a > b">x</p>'), { title: "a > b" });
  assert.deepEqual(attrs("<p title='a > b'>x</p>"), { title: "a > b" });
  assert.deepEqual(attrs("<p class=lead>x</p>"), { class: "lead" });
  assert.deepEqual(attrs("<p hidden>x</p>"), { hidden: "" });
  assert.deepEqual(attrs('<p data-x="1" data-y="2">x</p>'), { "data-x": "1", "data-y": "2" });
  assert.deepEqual(attrs('<p CLASS="Lead">x</p>'), { class: "Lead" });
  assert.deepEqual(attrs('<p title = "spaced" >x</p>'), { title: "spaced" });
  // Duplicate keys: the last one wins, as a browser does.
  assert.deepEqual(attrs('<p title="first" title="second">x</p>'), { title: "second" });
  assert.deepEqual(attrs('<a href="/a?b=1&amp;c=2">x</a>'), { href: "/a?b=1&c=2" });
  assert.deepEqual(attrs('<img src="/i.png" alt="" >'), { src: "/i.png", alt: "" });
  assert.deepEqual(attrs('<a\n  href="/x"\n  rel="nofollow"\n>x</a>'), {
    href: "/x",
    rel: "nofollow",
  });
  assert.deepEqual(attrs('<img src="/i.png"/>'), { src: "/i.png" });
  // A `>` inside a value does not end the tag, so nothing after it leaks.
  assert.equal(treeText('<p title="a > b" data-x="c>d">visible</p>'), "visible");
});

test("an unterminated attribute value costs its own tag and nothing after it", () => {
  // The whole article used to disappear here. The anchor's own text is inside
  // what reads as an unterminated value and is lost with it; everything after
  // the tag survives, which is the bound this is here to hold.
  assert.equal(
    treeText('<p>intro</p><a href="/x>Click</a><p>The rest.</p><h2>More</h2>'),
    "introThe rest.More",
  );
  assert.deepEqual(tags('<a href="/x>Click</a>after'), ["a", "/a"]);
  // Consistently: text between the unterminated quote and the next `<` is part
  // of the value and goes with it. Everything from that `<` on survives.
  assert.equal(treeText("<p title='unterminated>body</p>after"), "after");
  assert.equal(treeText("<p title=unterminated"), "");
  assert.equal(treeText("<p"), "");
  assert.equal(treeText("<p >x</p>"), "x");
});

/* -------------------------------------------------------------------------- */
/* Structural position: what closes what                                       */
/* -------------------------------------------------------------------------- */

test("implied and stray end tags land where a browser puts them", () => {
  const table: [string, string[]][] = [
    // `<p>a<p>b` is two siblings, not a nest.
    ["<p>a<p>b", ["p", "p"]],
    ["<ul><li>a<li>b</ul>", ["ul", "li", "li", "/ul"]],
    ["<table><tr><td>a<td>b<tr><td>c</table>", ["table", "tr", "td", "td", "tr", "td", "/table"]],
  ];
  for (const [html, expected] of table) assert.deepEqual(tags(html), expected, html);

  const root = buildTree(tokenize("<p>a<p>b"));
  assert.equal(root.children.length, 2);

  // A close tag matching nothing open is discarded, not rendered.
  assert.equal(treeText("</div><p>x</p></span>"), "x");
  // A close tag matching an ancestor closes up to it rather than being ignored.
  assert.equal(treeText("<div><p>x</div>y"), "xy");
  // An unclosed tag ends at the end of the document, taking nothing with it.
  assert.equal(treeText("<p>Unclosed"), "Unclosed");
  assert.equal(treeText("<div><p>a<div><p>b"), "ab");
  // Void elements never open a scope.
  assert.equal(buildTree(tokenize("<br>a<br>b")).children.length, 4);
  assert.equal(buildTree(tokenize('<img src="/i.png">a')).children.length, 2);
});

/* -------------------------------------------------------------------------- */
/* Entities                                                                    */
/* -------------------------------------------------------------------------- */

test("entities decode in one pass, and an unknown one is left alone", () => {
  const table: [string, string][] = [
    ["a &amp; b", "a & b"],
    ["&lt;p&gt;", "<p>"],
    ["&amp;lt;", "&lt;"],
    ["&#39;q&#39;", "'q'"],
    ["&#x27;q&#x27;", "'q'"],
    ["&#X2014;", "—"],
    ["&nbsp;", " "],
    ["&unknownentity;", "&unknownentity;"],
    // A prototype key is not an entity name.
    ["&constructor;", "&constructor;"],
    ["&toString;", "&toString;"],
    ["&amp", "&amp"],
    ["&#;", "&#;"],
    ["&#0;", "&#0;"],
    ["&#x110000;", "&#x110000;"],
    // A lone surrogate is not a character, so it stays as its own source text.
    ["&#xD800;", "&#xD800;"],
    ["&#xDFFF;", "&#xDFFF;"],
    // Nothing else is refused. These used to be, because a body that could
    // spell one could displace a node from the sentinel string that held its
    // place; a place is a list entry now, so no character is special.
    ["&#xFFFC;", "\ufffc"],
    ["&#xFFF9;", "\ufff9"],
    ["&#65532;", "\ufffc"],
    ["&#xFFF8;", "\ufff8"],
    ["&#xFFFE;", "\ufffe"],
    ["Q&A and R&D", "Q&A and R&D"],
    ["100% &lt; 200%", "100% < 200%"],
  ];
  for (const [raw, expected] of table) assert.equal(decodeEntities(raw), expected, raw);
});

/* -------------------------------------------------------------------------- */
/* Bounded: nothing malformed may cost more than its own construct             */
/* -------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */
/* Verbatim regions: lexed ahead of every tag, because inside one nothing is    */
/* -------------------------------------------------------------------------- */

/** Every verbatim region the scanner found, in document order. */
function verbatim(html: string): string[] {
  return tokenize(html).flatMap((token) =>
    token.type === "verbatim" ? [`${token.block ? "block" : "span"}:${token.text}`] : [],
  );
}

test("a code span and a fence are content, and hold their tags", () => {
  const table: [string, string[]][] = [
    ["Use `<div>` to wrap it.", ["span:<div>"]],
    // A code span may name a dropped tag, because an unterminated one has no
    // content to reveal — this is prose about a tag.
    ["Use `<script>` carefully", ["span:<script>"]],
    ["Use `<style>` and `<template>` too", ["span:<style>", "span:<template>"]],
    // But it may not hold a TERMINATED one. Two backticks that pair across a
    // real element are an accident, not an author asking to display source, and
    // honouring them would re-present content rule 1 exists to remove.
    ["`<script>alert(1)</script>`", []],
    ["`a <noscript>SECRET</noscript> b`", []],
    // A fence may, because it IS an author asking to display source.
    ["```\n<script>alert(1)</script>\n```", ["block:<script>alert(1)</script>"]],
    ["```\n<p>x</p>\n```", ["block:<p>x</p>"]],
    ["```bash\nls\n```", ["block:ls"]],
    ["```\nfirst\n\nsecond\n```", ["block:first\n\nsecond"]],
    // An unterminated fence runs to the end rather than swallowing nothing.
    ["```\ndangling", ["block:dangling"]],
    ["```", ["block:"]],
    ["  ```\nindented\n  ```", ["block:indented"]],
    // Not a fence: it does not open a line. The empty pairs are punctuation and
    // what is left is one span, so no line of the body is lost either way.
    ["text ```\nx\n```", ["span:\nx\n"]],
    // A code span is inline: it cannot leave the block it opened in, so an
    // unpaired backtick costs its own paragraph and not the structure of every
    // paragraph after it.
    ["a `b\nc` d", ["span:b\nc"]],
    ["one `unpaired\n\ntwo `also unpaired", []],
    ["<p>a `x</p>\n\n<p>b `y</p>", []],
    // CRLF and lone CR are normalised at the scanner, so a blank line bounds a
    // span whatever wrote it.
    ["one `unpaired\r\n\r\ntwo `also unpaired", []],
    ["Intro `x\r\n\r\n<h2>S</h2>\r\n\r\n` tail", []],
    ["a `b` c\r\nd `e` f", ["span:b", "span:e"]],
    ["```\r\nfirst\r\n\r\nsecond\r\n```", ["block:first\n\nsecond"]],
    // A fence IS a block, so blank lines are its content, not its end.
    ["```\nfirst\n\nsecond\n```", ["block:first\n\nsecond"]],
    // And the block bound is what keeps the decision LOCAL: whether
    // `` `<script>` `` is prose about a tag must not turn on a `</script>`
    // belonging to some other paragraph.
    ["Use `<script>` here\n\n```\n<script>alert(1)</script>\n```", [
      "span:<script>",
      "block:<script>alert(1)</script>",
    ]],
    ["Use `<script>` here\n\n<p>later <script>alert(1)</script> tail</p>", ["span:<script>"]],
    // Not a span: a lone backtick is punctuation, and an empty pair is text.
    ["a ` b", []],
    ["a `` b", []],
    ["it's 90` today", []],
  ];
  for (const [html, expected] of table) assert.deepEqual(verbatim(html), expected, html);
  assert.equal(textOf(buildTree(tokenize("Use `<div>` to wrap it."))), "Use <div> to wrap it.");
});

test("a verbatim region reproduces its own source exactly", () => {
  // Inside a `<pre>` the delimiters are ordinary characters of the body, so a
  // region has to be able to hand back what it was written as. Asserted as a
  // round trip over every shape rather than as the one field that was lost:
  // anything a rebuild would have to re-invent — an info string, indentation,
  // the delimiter count, a missing closer — is covered by construction.
  // Tag-free, because `<pre>` has never been a raw-text element here: a tag
  // inside one is still tokenized as a tag. What is asserted is that the
  // DELIMITERS survive, which is what the rebuild used to lose.
  const inners = [
    "```bash\nls -la\n```",
    "```\nplain\n```",
    "```js\nconst a = 1;\n```",
    "  ```bash\nindented open and close\n  ```",
    "```bash\nfirst\n\nsecond\n```",
    "```unterminated\nno closing fence",
    "a `code span` b",
    "a ``double`` b",
    "``",
  ];
  /** A subtree read as RAW text, the way the `<pre>` path reads it: a verbatim
   * region contributes the source it was written as, delimiters included. */
  const rawText = (node: HtmlNode): string => {
    if (node.type === "text") return node.value;
    if (node.type === "verbatim") return verbatimSource(node);
    return node.children.map(rawText).join("");
  };
  for (const inner of inners) {
    const tree = buildTree(tokenize(`<pre>${inner}</pre>`));
    assert.equal(rawText(tree), inner, JSON.stringify(inner));
  }

  // A fence inside a `<pre>` must not eat the `</pre>`: an unterminated one runs
  // to the end of the body, and taking the close tag with it would swallow the
  // element and everything after it.
  for (const inner of ["```bash\nls", "```\na\n```", "text\n```\ntail"]) {
    const tags = tokenize(`<pre>\n${inner}\n</pre><p>after</p>`).flatMap((token) =>
      token.type === "open" ? [token.tag] : token.type === "close" ? [`/${token.tag}`] : [],
    );
    assert.deepEqual(tags, ["pre", "/pre", "p", "/p"], JSON.stringify(inner));
  }

  // And a region outside a `<pre>` still exposes its CONTENT, without
  // delimiters, to everything that reads it as code.
  const regions = tokenize("```bash\nls\n```").filter((token) => token.type === "verbatim");
  assert.equal(regions.length, 1);
  assert.ok(regions[0].type === "verbatim" && regions[0].text === "ls");
  assert.ok(regions[0].type === "verbatim" && regions[0].source === "```bash\nls\n```");
});

test("a verbatim region cannot close outside text position", () => {
  // A region opens in text, because the scanner only offers a delimiter as an
  // opener when it precedes the next `<`. Its closer has to be held to the same
  // standard: a backtick inside `title="x`">` closing a span that began in prose
  // ate the `<script>` opener it sat in, and left that element's payload on the
  // page as ordinary words.
  const table: [string, string[]][] = [
    // The reviewer's case, and the same shape for every dropped tag.
    ['<p>before `x <script title="x`">alert(1)</script>after</p>', []],
    ['<p>before `x <style title="x`">body{}</style>after</p>', []],
    ['<p>before `x <template title="x`">hidden</template>after</p>', []],
    ['<p>before `x <noscript title="x`">hidden</noscript>after</p>', []],
    // Adjacent variants: the closer inside a dropped element's BODY rather than
    // its attributes, inside a comment, and inside a NON-dropped element's
    // attribute. None of those positions is text either.
    ['<p>before `x <script>var s = "`";alert(1)</script>after</p>', []],
    ["<p>before `x <!-- ` --> after</p>", []],
    ['<p>before `x <a title="x`" href="/y">link</a>after</p>', []],
    // An unterminated attribute value is still not text.
    ['<p>before `x <a title="x` href=/y>after</p>', []],
    // A fence whose closing line sits inside an attribute value never was a
    // line of this document, so it does not close the fence.
    ['```\n<p title="\n```\n">x</p>\n', ["block:<p title=\"\n```\n\">x</p>\n"]],
  ];
  for (const [html, expected] of table) assert.deepEqual(verbatim(html), expected, html);

  // The outcome that matters: no dropped element's content reaches the tree,
  // as text OR as a verbatim region.
  for (const [html] of table) {
    const text = textOf(buildTree(tokenize(html)));
    assert.ok(!/alert\(1\)|body\{\}|hidden|SECRET/.test(text), `${html} => ${text}`);
  }
});

test("a backtick that is not in text position is not a delimiter", () => {
  // The one authority for where a tag is decides where the text is, so a
  // backtick inside an attribute value or inside dropped content is neither the
  // start nor the end of a verbatim region.
  const table: [string, string[]][] = [
    ['<p title="a `b` c">visible</p>', []],
    ["<p title='`'>a</p><p title='`'>b</p>", []],
    ["<script>const a = `x`;</script>keep", []],
    ["<style>p::after{content:'`'}</style>keep", []],
    ['<a href="/x?q=`">visible</a>', []],
    // The comment's backtick is not a delimiter, so the pair after it is the
    // span — rather than the comment's backtick pairing with the first real one
    // and shifting every region in the body by one.
    ["<!-- ` --> keep ` and `", ["span: and "]],
  ];
  for (const [html, expected] of table) assert.deepEqual(verbatim(html), expected, html);
  assert.equal(textOf(buildTree(tokenize('<p title="a `b` c">visible</p>'))), "visible");
  assert.equal(textOf(buildTree(tokenize("<script>const a = `x`;</script>keep"))), "keep");
});

test("a verbatim region can span a tag boundary without breaking either", () => {
  // The region is a token, not a slice of the source, so an element around one
  // still nests: `<b>a `c` b</b>` is one bold run holding a code span.
  const tree = buildTree(tokenize("<b>a `c` b</b>"));
  assert.equal(tree.children.length, 1);
  const bold = tree.children[0];
  assert.ok(bold.type === "element" && bold.tag === "b");
  if (bold.type !== "element") return;
  assert.deepEqual(
    bold.children.map((child) => child.type),
    ["text", "verbatim", "text"],
  );
});

test("a large and a pathological body both complete", () => {
  const chunk = '<p class="lead" data-x="y">Text <a href="https://e.com/a?b=1&amp;c=2">l</a></p>';
  const big = chunk.repeat(Math.ceil(200_000 / chunk.length));
  assert.ok(big.length >= 200_000);
  const started = Date.now();
  assert.ok(tokenize(big).length > 1000);
  // A long run of `<` that opens nothing, and a long unterminated value.
  assert.deepEqual(tags("<".repeat(50_000)), []);
  assert.deepEqual(tags(`<p title="${"a".repeat(50_000)}`), ["p"]);
  // A body with no backticks must not rescan its tail once per tag, and one
  // that is nothing but backticks must not rescan once per backtick.
  assert.ok(tokenize("a ` b ".repeat(30_000)).length >= 0);
  assert.equal(verbatim("x `c` ".repeat(20_000)).length, 20_000);
  assert.ok(Date.now() - started < 5_000, "scanning took too long");
});

/* -------------------------------------------------------------------------- */
/* Positives, taken from what the fixtures actually contain                    */
/* -------------------------------------------------------------------------- */

test("the shapes the pipeline really emits scan correctly", () => {
  const table: [string, string[]][] = [
    ['<p><strong><a href="https://e.com/c/">Schedule Service.</a></strong></p>', [
      "p",
      "strong",
      "a",
      "/a",
      "/strong",
      "/p",
    ]],
    ['<div class="answer-capsule"><p>Answer.</p></div>', ["div", "p", "/p", "/div"]],
    ['<table><thead><tr><th scope="col">A</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>', [
      "table",
      "thead",
      "tr",
      "th",
      "/th",
      "/tr",
      "/thead",
      "tbody",
      "tr",
      "td",
      "/td",
      "/tr",
      "/tbody",
      "/table",
    ]],
    ["<ol><li>One.</li><li>Two.</li></ol>", ["ol", "li", "/li", "li", "/li", "/ol"]],
    ['<figure><img alt="A" loading="lazy" src="/i.webp"><figcaption>C</figcaption></figure>', [
      "figure",
      "img",
      "figcaption",
      "/figcaption",
      "/figure",
    ]],
    ['<p>Call <a href="tel:8563171770">(856) 317-1770</a> today.</p>', [
      "p",
      "a",
      "/a",
      "/p",
    ]],
    ['<a href="https://e.com" rel="nofollow" target="_blank">ADA</a>', ["a", "/a"]],
  ];
  for (const [html, expected] of table) assert.deepEqual(tags(html), expected, html);
});

test("every committed fixture scans with no markup left in its text", () => {
  const names = readdirSync(FIXTURE_DIR).filter((name) => name.endsWith(".md"));
  assert.ok(names.length >= 5, "expected the published-post fixtures");
  for (const name of names) {
    const raw = readFileSync(join(FIXTURE_DIR, name), "utf8");
    const text = treeText(raw);
    assert.ok(!/<\/?(p|div|h[1-6]|ul|ol|li|table|tr|td|th|a|strong|img)\b/i.test(text), name);
    assert.ok(!text.includes("application/ld+json"), name);
  }
});
