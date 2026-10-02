import assert from "node:assert/strict";
import test from "node:test";

import { parseBlocks, parseInline, type Block, type InlineNode } from "./markdown.ts";

/** Every string a reader can end up seeing, from every block kind. */
function visibleTextOf(blocks: Block[]): string[] {
  const fromInline = (nodes: InlineNode[]): string[] => [visibleText(nodes)];
  return blocks.flatMap((block) => {
    switch (block.kind) {
      case "paragraph":
      case "heading":
        return fromInline(block.inline);
      case "list": {
        const items = (list: typeof block.items): string[] =>
          list.flatMap((item) => [
            ...fromInline(item.inline),
            ...item.children.flatMap((group) => items(group.items)),
          ]);
        return items(block.items);
      }
      case "blockquote":
        return block.lines.flatMap(fromInline);
      case "table":
        return [block.header, ...block.rows].flatMap((row) => row.flatMap(fromInline));
      case "code":
        return [block.text];
      default:
        return [block.alt, block.src];
    }
  });
}

/** Every string a reader can end up seeing in a run of inline nodes. */
function visibleText(nodes: InlineNode[]): string {
  return nodes
    .map((node) => {
      if (node.kind === "link") return `${node.text} ${node.href}`;
      if (node.kind === "image") return `${node.alt} ${node.src}`;
      return node.value;
    })
    .join(" ");
}

function kinds(source: string): string[] {
  return parseBlocks(source).map((block) => block.kind);
}

function first(source: string): Block {
  const blocks = parseBlocks(source);
  assert.ok(blocks.length > 0, "expected at least one block");
  return blocks[0];
}

test("headings", () => {
  const block = first("## Why it matters");
  assert.equal(block.kind, "heading");
  if (block.kind !== "heading") return;
  assert.equal(block.level, 2);
  assert.deepEqual(block.inline, [{ kind: "text", value: "Why it matters" }]);

  const three = first("### How");
  assert.equal(three.kind === "heading" && three.level, 3);
});

test("heading depth and the leading H1", () => {
  // The pipeline repeats the post title as a leading H1 and the page template
  // already renders it, so the duplicate is dropped rather than demoted to a
  // visible H2 that says the headline twice.
  const table: [string, (string | number)[]][] = [
    ["# Title\n\nBody", ["paragraph"]],
    ["Body\n\n# Later", ["paragraph", "heading:2"]],
    ["#### Deep", ["heading:3"]],
    ["###### Deepest", ["heading:3"]],
    ["####### Seven", ["paragraph"]],
    ["#NoSpace", ["paragraph"]],
    ["# One\n\n# Two", ["heading:2"]],
    // A body that is nothing but its title is not a duplicate of anything;
    // dropping it would render a blank article with no signal anywhere.
    ["# Only heading", ["heading:2"]],
    ["![Cover](/a.jpg)\n\n# After an image", ["image", "heading:2"]],
  ];
  for (const [source, expected] of table) {
    const actual = parseBlocks(source).map((block) =>
      block.kind === "heading" ? `heading:${block.level}` : block.kind,
    );
    assert.deepEqual(actual, expected, source);
  }
});

test("a mark wrapping another mark never prints its own syntax", () => {
  // The pipeline's standard CTA is `**[text](href)**`, and `strong` carries a
  // plain string, so the old parser printed the link syntax at the reader.
  const table: [string, InlineNode[]][] = [
    [
      "**[Contact us](https://x.com/c)**",
      [{ kind: "link", text: "Contact us", href: "https://x.com/c" }],
    ],
    ["*[Read more](/blog)*", [{ kind: "link", text: "Read more", href: "/blog" }]],
    ["[**Bold link**](/x)", [{ kind: "link", text: "Bold link", href: "/x" }]],
    ["[a `code` b](/x)", [{ kind: "link", text: "a code b", href: "/x" }]],
    ["**plain bold**", [{ kind: "strong", value: "plain bold" }]],
    ["`**not bold**`", [{ kind: "code", value: "**not bold**" }]],
    ["![**Alt**](/i.jpg)", [{ kind: "image", alt: "Alt", src: "/i.jpg" }]],
  ];
  for (const [source, expected] of table) {
    const block = first(source);
    if (block.kind === "paragraph") {
      assert.deepEqual(block.inline, expected, source);
      continue;
    }
    if (block.kind === "image") {
      assert.deepEqual([{ kind: "image", alt: block.alt, src: block.src }], expected, source);
      continue;
    }
    assert.fail(`unexpected block kind ${block.kind} for ${source}`);
  }
});

test("inline HTML inside a markdown body becomes nodes, never source", () => {
  const table: [string, InlineNode[]][] = [
    [
      'Call <a href="/x">now</a> please.',
      [
        { kind: "text", value: "Call " },
        { kind: "link", text: "now", href: "/x" },
        { kind: "text", value: " please." },
      ],
    ],
    // A mark BRACKETING a tag: the mark cannot hold a link, so the link wins.
    [
      '**<a href="/x">Buy</a>** now',
      [{ kind: "link", text: "Buy", href: "/x" }, { kind: "text", value: " now" }],
    ],
    // A mark INSIDE a tag: the link survives and the mark resolves to text.
    ['<a href="/x">**Buy**</a>', [{ kind: "link", text: "Buy", href: "/x" }]],
    ["<b>**bold**</b>", [{ kind: "strong", value: "bold" }]],
    ["a &amp; b <b>c</b>", [{ kind: "text", value: "a & b " }, { kind: "strong", value: "c" }]],
    // One grammar for every body, so an entity decodes wherever it was written
    // rather than only in the bodies that happened to carry a tag as well.
    ["AT&amp;T sells them", [{ kind: "text", value: "AT&T sells them" }]],
    ["A comment <!-- hidden --> gone", [{ kind: "text", value: "A comment gone" }]],
    // Prose that looks like a tag IS a tag now, and is unwrapped by rule 2 —
    // which is what a browser does with the same bytes. The bracketed text goes;
    // it is never printed at the reader as source, which is the invariant.
    ["Mail <sales@example.com> today.", [{ kind: "text", value: "Mail today." }]],
    ["use List<string> here", [{ kind: "text", value: "use List here" }]],
    // A code span is verbatim, so the HTML pass never sees inside one.
    [
      "Use `<div>` to wrap it.",
      [
        { kind: "text", value: "Use " },
        { kind: "code", value: "<div>" },
        { kind: "text", value: " to wrap it." },
      ],
    ],
    [
      "Link `<a href>` and <b>bold</b>",
      [
        { kind: "text", value: "Link " },
        { kind: "code", value: "<a href>" },
        { kind: "text", value: " and " },
        { kind: "strong", value: "bold" },
      ],
    ],
    // A destination interrupted by markup is not a destination, so no link is
    // built from it — and the nodes that follow still land in source order.
    [
      "[click](https://x.com/<b>W</b>) then <i>later</i>",
      [{ kind: "text", value: "click then " }, { kind: "em", value: "later" }],
    ],
  ];
  for (const [source, expected] of table) {
    const block = first(source);
    assert.equal(block.kind, "paragraph", source);
    if (block.kind !== "paragraph") continue;
    assert.deepEqual(block.inline, expected, source);
  }
});

test("a level 1 heading below the top is kept, not dropped", () => {
  const blocks = parseBlocks("Intro.\n\n# Section");
  assert.equal(blocks[1].kind === "heading" && blocks[1].level, 2);
  assert.deepEqual(blocks[1].kind === "heading" && blocks[1].inline, [
    { kind: "text", value: "Section" },
  ]);
});

test("a markdown link with a refused scheme keeps its words", () => {
  // The same allow-list as the HTML path: a `javascript:` URL never reaches an
  // href, and the link text is never lost with it.
  const table: [string, InlineNode[]][] = [
    ["[Click](javascript:alert)", [{ kind: "text", value: "Click" }]],
    ["[Click](vbscript:x)", [{ kind: "text", value: "Click" }]],
    ["[Click](data:text/html,x)", [{ kind: "text", value: "Click" }]],
    // The words stay PARSED. Emitting the label raw printed its own asterisks,
    // which is the leak this PR exists to stop, arriving through the fallback.
    ["[**Click**](javascript:alert)", [{ kind: "strong", value: "Click" }]],
    [
      "[a `code` b](vbscript:x)",
      [
        { kind: "text", value: "a " },
        { kind: "code", value: "code" },
        { kind: "text", value: " b" },
      ],
    ],
    // The same rule for an image: a refused src costs the image, not its alt.
    [
      "![**Alt**](javascript:x) after",
      [{ kind: "strong", value: "Alt" }, { kind: "text", value: " after" }],
    ],
    ["[Click](/pricing)", [{ kind: "link", text: "Click", href: "/pricing" }]],
    [
      "[Mail](mailto:a@b.c)",
      [{ kind: "link", text: "Mail", href: "mailto:a@b.c" }],
    ],
  ];
  for (const [source, expected] of table) {
    const block = first(source);
    assert.equal(block.kind, "paragraph", source);
    if (block.kind !== "paragraph") continue;
    assert.deepEqual(block.inline, expected, source);
  }
});

test("inert markup is dropped on the markdown path too, and never escaped", () => {
  // Rule 1 is not conditional on which parser runs. A markdown signal outside
  // the element routes this to the markdown path, and an unterminated
  // `<script>` there used to render as visible escaped source.
  const table: [string, (string | number)[]][] = [
    ["## Head\n<script>alert(1)", ["heading:2"]],
    ["## Head\n\n<script>alert(1)</script>", ["heading:2"]],
    ["## Head\n\n<!-- hidden -->", ["heading:2"]],
    ["## Head\n\nText <script>alert(1)</script> after", ["heading:2", "paragraph"]],
    ["<script>alert(1)", []],
  ];
  for (const [source, expected] of table) {
    const blocks = parseBlocks(source);
    assert.deepEqual(
      blocks.map((block) => (block.kind === "heading" ? `heading:${block.level}` : block.kind)),
      expected,
      source,
    );
    for (const block of blocks) {
      const text = block.kind === "paragraph" || block.kind === "heading"
        ? block.inline.map((node) => (node.kind === "text" ? node.value : "")).join("")
        : "";
      assert.ok(!text.includes("alert"), source);
      assert.ok(!text.includes("<"), source);
    }
  }
});

test("a body cannot displace a node by spelling a character", () => {
  // #58 finding 1. A node's place used to be held by a sentinel CHARACTER, so
  // `&#xFFFC;` in a body consumed a node's slot and slid every later node onto
  // the wrong one, reordering the paragraph silently. A place is a list entry
  // now, so there is no character left to spell: these decode like any other,
  // and every node stays where the body put it.
  const table: [string, InlineNode[]][] = [
    [
      "<b>x</b>&#xFFFC;<i>y</i>",
      [
        { kind: "strong", value: "x" },
        { kind: "text", value: "\ufffc" },
        { kind: "em", value: "y" },
      ],
    ],
    [
      "&#xFFF9;<b>x</b> and `c`",
      [
        { kind: "text", value: "\ufff9" },
        { kind: "strong", value: "x" },
        { kind: "text", value: " and " },
        { kind: "code", value: "c" },
      ],
    ],
    // Written literally rather than as an entity: the same, because neither
    // spelling means anything to the parser.
    [
      "a \ufffc b <b>c</b>",
      [{ kind: "text", value: "a \ufffc b " }, { kind: "strong", value: "c" }],
    ],
    [
      "one `c` two <b>three</b> four [five](/5) six",
      [
        { kind: "text", value: "one " },
        { kind: "code", value: "c" },
        { kind: "text", value: " two " },
        { kind: "strong", value: "three" },
        { kind: "text", value: " four " },
        { kind: "link", text: "five", href: "/5" },
        { kind: "text", value: " six" },
      ],
    ],
  ];
  for (const [source, expected] of table) {
    assert.deepEqual(parseInline(source), expected, JSON.stringify(source));
  }
});

test("quoted attribute content does not stop inline HTML from parsing", () => {
  // #58 finding 6. Tag-shaped text inside an attribute value used to make the
  // whole paragraph fail to parse as HTML, and it then shipped to the reader as
  // escaped source. The scanner is the only thing that decides where a tag is,
  // so a quoted value is a string to every layer above it.
  const table: [string, InlineNode[]][] = [
    ['Intro <p title="<a>">visible</p>', [{ kind: "text", value: "Intro visible" }]],
    [
      'Read <a href="/x" title="<b>quoted</b>">now</a> please',
      [
        { kind: "text", value: "Read " },
        { kind: "link", text: "now", href: "/x" },
        { kind: "text", value: " please" },
      ],
    ],
    [
      "a <b title='</b>'>x</b> b",
      [
        { kind: "text", value: "a " },
        { kind: "strong", value: "x" },
        { kind: "text", value: " b" },
      ],
    ],
    // A single-quoted value, an unquoted value carrying `>`, a bare `<` that is
    // not tag-shaped, an apparent close tag, and a comment holding tag-shaped
    // text: every one of these used to skew the count.
    ["Intro <p title='<a>'>visible</p>", [{ kind: "text", value: "Intro visible" }]],
    ["Intro <p data-x=a>b>visible</p>", [{ kind: "text", value: "Intro b>visible" }]],
    ['Intro <p title="a < b">visible</p>', [{ kind: "text", value: "Intro visible" }]],
    ['Intro <p title="</p>">visible</p>', [{ kind: "text", value: "Intro visible" }]],
    ["<!-- <a> --><b>x</b>", [{ kind: "strong", value: "x" }]],
    // A dropped-tag spelling inside an attribute is a string, not an element.
    // Believing it deleted the rest of the document and then escaped what was
    // left onto the page.
    ['Intro <p title="<script>">visible</p>', [{ kind: "text", value: "Intro visible" }]],
    ["Intro <p title='<style>'>visible</p>", [{ kind: "text", value: "Intro visible" }]],
    // Prose naming a tag is unwrapped like any other tag, as a browser does.
    // The words survive; the brackets are never printed at the reader.
    ["The <section> tag groups content.", [{ kind: "text", value: "The tag groups content." }]],
    ["use List<string> here", [{ kind: "text", value: "use List here" }]],
  ];
  for (const [source, expected] of table) {
    assert.deepEqual(parseInline(source), expected, source);
    assert.ok(!visibleText(parseInline(source)).includes("<"), source);
  }
});

test("a body carrying both grammars keeps the structure of each", () => {
  // There is no routing decision left to get wrong. The tags give the blocks
  // and the text between them gives the rest, so a body that is markdown with a
  // stray wrapper in it, or HTML with markdown between its tags, keeps both.
  const table: [string, string[]][] = [
    ['Intro.\n\nSee <a href="/x"\ntitle="\n<p>not a tag">here</a>.\n\n## Head', [
      "paragraph",
      "paragraph",
      "heading:2",
    ]],
    ["Intro.\n\n<!--\n<p>commented</p>\n-->\n\n## Head\n\n- one", [
      "paragraph",
      "heading:2",
      "list",
    ]],
    // A fence is verbatim wherever it sits, so the tag inside it is content and
    // the heading after it is still a heading.
    ["Intro.\n\n```\n<p>example</p>\n```\n\n## Head", ["paragraph", "code", "heading:2"]],
    ['Intro.\n\n<div class="cta">Call now</div>\n\n## Heading\n\n- one', [
      "paragraph",
      "paragraph",
      "heading:2",
      "list",
    ]],
    ["<p>Real.</p>\n<h2>Head</h2>", ["paragraph", "heading:2"]],
    ['<script type="application/ld+json">{}</script>Lead prose.\n<p>x</p>', [
      "paragraph",
      "paragraph",
    ]],
    // Markdown between two top-level tags is read as markdown, which is what
    // the old per-body veto existed to protect and now needs no veto.
    ["<p>Lead.</p>\n\n## Head\n\n- one\n- two\n\n<p>Tail.</p>", [
      "paragraph",
      "heading:2",
      "list",
      "paragraph",
    ]],
  ];
  for (const [source, expected] of table) {
    const blocks = parseBlocks(source);
    assert.deepEqual(
      blocks.map((block) => (block.kind === "heading" ? `heading:${block.level}` : block.kind)),
      expected,
      JSON.stringify(source),
    );
  }
});

test("a body parses the same whatever its line endings are", () => {
  // Review round 2. The block-local code-span bound recognised a blank line
  // only as `\n` + spaces + `\n`, so in CRLF text — where a blank line starts
  // with `\r` — the bound was never found, and a code span reached past a
  // heading and swallowed it.
  //
  // Asserted as the property rather than that one shape: nine places in this
  // parser look for a newline, so the fix is to normalise once at the scanner
  // (as the HTML spec's input preprocessing does) and this test is what says
  // no tenth place has to be taught.
  const bodies: [string, string][] = [
    // The reported case: a code span opening before a CRLF blank line, with an
    // HTML block after it that must survive as a block.
    ["a span across a blank line", "Intro `x\n\n<h2>Section</h2>\n\n` tail"],
    ["paragraphs", "One.\n\nTwo.\n\nThree."],
    ["a wrapped paragraph", "One line\nsecond line"],
    ["a heading and a list", "## Head\n\n- a\n- b\n\n1. c"],
    ["a fence", "```\nnpm run build\n```"],
    ["a fence holding a blank line", "```\nfirst\n\nsecond\n```"],
    ["an indented closing fence", "  ```\nindented\n  ```"],
    ["a table", "| A | B |\n| --- | --- |\n| 1 | 2 |"],
    ["a blockquote", "> One.\n> Two."],
    ["html blocks", "<p>a</p>\n\n<h2>b</h2>\n\n<ul><li>c</li></ul>"],
    ["html holding a pre", "<pre>one\ntwo</pre>\n\n<p>after</p>"],
    ["a mark and a link", "A **bold** word and a [link](/x)."],
  ];
  for (const [name, body] of bodies) {
    const lf = parseBlocks(body);
    // Every block kind still present, so a swallowed heading cannot pass.
    assert.ok(lf.length > 0, name);
    assert.deepEqual(parseBlocks(body.replace(/\n/g, "\r\n")), lf, `${name}: CRLF`);
    assert.deepEqual(parseBlocks(body.replace(/\n/g, "\r")), lf, `${name}: CR`);
  }

  // And the reported case specifically keeps its heading as a heading.
  assert.deepEqual(
    parseBlocks("Intro `x\r\n\r\n<h2>Section</h2>\r\n\r\n` tail").map((block) =>
      block.kind === "heading" ? `heading:${block.level}` : block.kind,
    ),
    ["paragraph", "heading:2", "paragraph"],
  );
});

test("a code span cannot smuggle dropped content past rule 1", () => {
  // Review round 1 on this PR. The verbatim lexer picked its OPENER in text
  // position but found its CLOSER with an unrestricted search, so a backtick in
  // prose could pair with one inside a later tag, swallow that tag's opener, and
  // leave the element's payload on the page as ordinary paragraph words.
  //
  // Asserted as the outcome across the whole class, not the one shape cited:
  // the closer inside an attribute of each dropped tag, inside a dropped
  // element's body, inside a comment, inside a non-dropped element's attribute,
  // and a code span that would wrap a whole terminated dropped element.
  const table: [string, string][] = [
    ['<p>before `x <script title="x`">alert(1)</script>after</p>', "alert(1)"],
    ['<p>before `x <style title="x`">body{}</style>after</p>', "body{}"],
    ['<p>before `x <template title="x`">hidden</template>after</p>', "hidden"],
    ['<p>before `x <noscript title="x`">hidden</noscript>after</p>', "hidden"],
    ['<p>before `x <script>var s = "`";alert(1)</script>after</p>', "alert(1)"],
    ['<p>a `b <noscript title="c`">SECRET</noscript> d`</p>', "SECRET"],
    ["<p>a `b <script>alert(1)</script> c`</p>", "alert(1)"],
    ["`<script>alert(1)</script>`", "alert(1)"],
  ];
  for (const [source, payload] of table) {
    for (const text of visibleTextOf(parseBlocks(source))) {
      assert.ok(!text.includes(payload), `${source} => ${text}`);
    }
  }

  // And the prose the feature exists for still works: an unterminated dropped
  // tag has no content to reveal, so naming one in a code span is still prose
  // about a tag.
  assert.deepEqual(parseInline("Use `<script>` carefully"), [
    { kind: "text", value: "Use " },
    { kind: "code", value: "<script>" },
    { kind: "text", value: " carefully" },
  ]);
  assert.deepEqual(parseInline("Use `<div>` to wrap it."), [
    { kind: "text", value: "Use " },
    { kind: "code", value: "<div>" },
    { kind: "text", value: " to wrap it." },
  ]);
});

test("a fence keeps its tags and a heading beside it stays a heading", () => {
  // #58 finding 4, from the other side: rule 1 removes inert markup wherever it
  // is written, and a fence is not inert markup, it is displayed content.
  const fenced = parseBlocks("## Head\n\n```\n<script>alert(1)</script>\n```");
  assert.deepEqual(fenced.map((block) => block.kind), ["heading", "code"]);
  assert.equal(fenced[1].kind === "code" && fenced[1].text, "<script>alert(1)</script>");
});

test("an unknown wrapper is markup, not text", () => {
  // `<article-body>` is not in the tag table, but a body opening with it is
  // still markup. Refusing to route it left the whole document on the markdown
  // path, where it rendered as escaped source.
  const table: [string, (string | number)[]][] = [
    ["<article-body><p>Hello</p><h2>Head</h2></article-body>", ["paragraph", "heading:2"]],
    ["<x-callout>Text here</x-callout>", ["paragraph"]],
    ["<Wrapper>\n<p>a</p>\n</Wrapper>", ["paragraph"]],
  ];
  for (const [source, expected] of table) {
    const blocks = parseBlocks(source);
    assert.deepEqual(
      blocks.map((block) => (block.kind === "heading" ? `heading:${block.level}` : block.kind)),
      expected,
      source,
    );
    for (const block of blocks) {
      const text =
        block.kind === "paragraph" || block.kind === "heading"
          ? block.inline.map((node) => (node.kind === "text" ? node.value : "")).join("")
          : "";
      assert.ok(!text.includes("<"), source);
    }
  }
});

test("a code span and a fence keep the tags they are about", () => {
  // The strip must not reach inside either: there the tag is displayed content.
  const block = first("Use `<script>` carefully");
  assert.equal(block.kind, "paragraph");
  if (block.kind !== "paragraph") return;
  assert.deepEqual(block.inline, [
    { kind: "text", value: "Use " },
    { kind: "code", value: "<script>" },
    { kind: "text", value: " carefully" },
  ]);
  const fence = first("```\n<script>alert(1)</script>\n```");
  assert.equal(fence.kind === "code" && fence.text, "<script>alert(1)</script>");
});

test("a destination interrupted by markup never becomes a URL", () => {
  // #58 finding 3. A destination used to be reassembled out of pieces after the
  // scheme check had already passed over it: `java<b>script</b>:alert` reached
  // the old tokenizer with the tag masked out, read as a relative path, and was
  // rebuilt into `javascript:alert(1)` afterwards. A destination is now one
  // contiguous run of source text or it is not a destination, so there is no
  // transformation left to run the check on the wrong side of.
  const table: [string, InlineNode[]][] = [
    ["[Click](java<b>script</b>:alert)", [{ kind: "text", value: "Click" }]],
    ["[Click](java<b></b>script:alert)", [{ kind: "text", value: "Click" }]],
    ["![Alt](java<b>script</b>:alert)", [{ kind: "text", value: "Alt" }]],
    ["[Click](<b>vb</b>script:x)", [{ kind: "text", value: "Click" }]],
    ["[Click](java<!-- c -->script:alert)", [{ kind: "text", value: "Click" }]],
    ["[Click](java<img src=x>script:alert)", [{ kind: "text", value: "Click" }]],
    // Even a destination that WOULD have been safe is refused, because the rule
    // is about where a URL may be read from and not about what it says.
    ["[Click](/pric<b>ing</b>)", [{ kind: "text", value: "Click" }]],
    // A destination that really is one run of text still resolves to a link.
    ["[Click](/pricing)", [{ kind: "link", text: "Click", href: "/pricing" }]],
    [
      '<a href="java&#115;cript:alert(1)">Click</a>',
      [{ kind: "text", value: "Click" }],
    ],
  ];
  for (const [source, expected] of table) {
    const nodes = parseInline(source);
    assert.deepEqual(nodes, expected, source);
    assert.ok(!/javascript:|vbscript:/i.test(visibleText(nodes)), source);
  }
});

test("a standalone image with a refused src keeps its alt as a paragraph", () => {
  const blocks = parseBlocks("![**Alt** text](javascript:x)");
  assert.deepEqual(blocks.map((block) => block.kind), ["paragraph"]);
  if (blocks[0].kind !== "paragraph") return;
  assert.deepEqual(blocks[0].inline, [
    { kind: "strong", value: "Alt" },
    { kind: "text", value: " text" },
  ]);
});

test("a fenced code block keeps HTML verbatim", () => {
  const block = first("```\n<div>x</div>\n```");
  assert.equal(block.kind === "code" && block.text, "<div>x</div>");
});

test("a row wider than the header keeps its extra cell", () => {
  // The markdown path used to truncate to the header width while the HTML path
  // kept the cell. One rule now, so the same source gives the same table.
  const block = first("| A |\n| --- |\n| 1 | 2 |");
  assert.equal(block.kind, "table");
  if (block.kind !== "table") return;
  assert.equal(block.header.length, 2);
  assert.deepEqual(block.rows[0][1], [{ kind: "text", value: "2" }]);
});

test("paragraphs join their wrapped lines", () => {
  const block = first("One line\nsecond line");
  assert.equal(block.kind, "paragraph");
  if (block.kind !== "paragraph") return;
  assert.deepEqual(block.inline, [
    { kind: "text", value: "One line second line" },
  ]);
});

test("blank lines separate blocks", () => {
  assert.deepEqual(kinds("One.\n\nTwo."), ["paragraph", "paragraph"]);
});

test("inline marks", () => {
  const block = first("Use **bold** and *em* and `code` and [link](https://x.com)");
  assert.equal(block.kind, "paragraph");
  if (block.kind !== "paragraph") return;
  assert.deepEqual(block.inline, [
    { kind: "text", value: "Use " },
    { kind: "strong", value: "bold" },
    { kind: "text", value: " and " },
    { kind: "em", value: "em" },
    { kind: "text", value: " and " },
    { kind: "code", value: "code" },
    { kind: "text", value: " and " },
    { kind: "link", text: "link", href: "https://x.com" },
  ]);
});

test("unordered list", () => {
  const block = first("- One\n- Two");
  assert.equal(block.kind, "list");
  if (block.kind !== "list") return;
  assert.equal(block.ordered, false);
  assert.equal(block.items.length, 2);
  assert.deepEqual(block.items[0].inline, [{ kind: "text", value: "One" }]);
});

test("ordered list", () => {
  const block = first("1. One\n2. Two");
  assert.equal(block.kind, "list");
  if (block.kind !== "list") return;
  assert.equal(block.ordered, true);
  assert.equal(block.items.length, 2);
});

test("one level of nesting becomes children, not separate items", () => {
  const block = first("- Top\n  - Sub\n  - Sub two\n- Next");
  assert.equal(block.kind, "list");
  if (block.kind !== "list") return;
  assert.equal(block.items.length, 2);
  // One child group, holding both same-marker children.
  assert.equal(block.items[0].children.length, 1);
  assert.equal(block.items[0].children[0].ordered, false);
  assert.equal(block.items[0].children[0].items.length, 2);
  assert.deepEqual(block.items[0].children[0].items[0].inline, [
    { kind: "text", value: "Sub" },
  ]);
  assert.equal(block.items[1].children.length, 0);
});

test("a nested item with no parent is promoted rather than dropped", () => {
  const block = first("  - Orphan");
  assert.equal(block.kind, "list");
  if (block.kind !== "list") return;
  assert.equal(block.items.length, 1);
  assert.deepEqual(block.items[0].inline, [{ kind: "text", value: "Orphan" }]);
});

test("nested ordered children keep their own marker type", () => {
  const block = first("1. Parent\n  1. Child");
  assert.equal(block.kind, "list");
  if (block.kind !== "list") return;
  assert.equal(block.ordered, true);
  assert.equal(block.items[0].children.length, 1);
  assert.equal(block.items[0].children[0].ordered, true);
});

test("a mixed nested list parses instead of falling back to a paragraph", () => {
  // `- Parent` + `  1. Child` matched neither all-unordered nor all-ordered,
  // so the whole block became a paragraph of literal markers.
  const block = first("- Parent\n  1. Child");
  assert.equal(block.kind, "list");
  if (block.kind !== "list") return;
  assert.equal(block.ordered, false);
  assert.equal(block.items[0].children[0].ordered, true);
  assert.deepEqual(block.items[0].children[0].items[0].inline, [
    { kind: "text", value: "Child" },
  ]);
});

test("an unordered child under an ordered parent keeps its type", () => {
  const block = first("1. Parent\n  - Child");
  assert.equal(block.kind === "list" && block.ordered, true);
  if (block.kind !== "list") return;
  assert.equal(block.items[0].children[0].ordered, false);
});

test("mixed markers at root level become separate lists, not a paragraph", () => {
  // The same defect one level up: neither every() branch matched.
  const blocks = parseBlocks("- One\n1. Two");
  assert.deepEqual(blocks.map((b) => b.kind), ["list", "list"]);
  assert.equal(blocks[0].kind === "list" && blocks[0].ordered, false);
  assert.equal(blocks[1].kind === "list" && blocks[1].ordered, true);
});

test("two child groups with different markers are kept separate", () => {
  const block = first("- Parent\n  - Bullet child\n  1. Numbered child");
  assert.equal(block.kind, "list");
  if (block.kind !== "list") return;
  assert.equal(block.items[0].children.length, 2);
  assert.equal(block.items[0].children[0].ordered, false);
  assert.equal(block.items[0].children[1].ordered, true);
});

test("different bullet characters are still one unordered list", () => {
  const blocks = parseBlocks("* One\n- Two");
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].kind === "list" && blocks[0].items.length, 2);
});

test("a second parent after nested children starts a sibling, not a child", () => {
  const block = first("- One\n  - Nested\n- Two");
  assert.equal(block.kind, "list");
  if (block.kind !== "list") return;
  assert.equal(block.items.length, 2);
  assert.equal(block.items[1].children.length, 0);
});

test("root ordered numbering is independent per list", () => {
  const blocks = parseBlocks("1. a\n- b\n3. c");
  assert.deepEqual(blocks.map((b) => b.kind), ["list", "list", "list"]);
});

test("blockquote", () => {
  const block = first("> Quoted line.");
  assert.equal(block.kind, "blockquote");
  if (block.kind !== "blockquote") return;
  assert.equal(block.lines.length, 1);
  assert.deepEqual(block.lines[0], [{ kind: "text", value: "Quoted line." }]);
});

test("a multi-line blockquote keeps each line", () => {
  const block = first("> One.\n> Two.");
  assert.equal(block.kind === "blockquote" && block.lines.length, 2);
});

test("a quote marker mid-paragraph is not a blockquote", () => {
  assert.equal(first("Costs 5 > 3 in practice").kind, "paragraph");
});

test("pipe table with a header rule", () => {
  const block = first("| A | B |\n| --- | --- |\n| 1 | 2 |");
  assert.equal(block.kind, "table");
  if (block.kind !== "table") return;
  assert.equal(block.header.length, 2);
  assert.deepEqual(block.header[0], [{ kind: "text", value: "A" }]);
  assert.equal(block.rows.length, 1);
  assert.deepEqual(block.rows[0][1], [{ kind: "text", value: "2" }]);
});

test("an escaped pipe inside a cell is unescaped, not a column break", () => {
  const block = first("| a\\|b |\n| --- |");
  assert.equal(block.kind, "table");
  if (block.kind !== "table") return;
  assert.equal(block.header.length, 1);
  assert.deepEqual(block.header[0], [{ kind: "text", value: "a|b" }]);
});

test("a ragged row is padded to the header width", () => {
  const block = first("| A | B |\n| --- | --- |\n| 1 |");
  assert.equal(block.kind, "table");
  if (block.kind !== "table") return;
  assert.equal(block.rows[0].length, 2);
});

test("pipes in a paragraph are not a table", () => {
  assert.equal(first("Cost | benefit").kind, "paragraph");
});

test("a table needs its separator row", () => {
  // Without one it is ambiguous, and treating it as a table would eat a line.
  assert.equal(first("| just | text |").kind, "paragraph");
});

test("fenced code", () => {
  const block = first("```\nnpm run build\n```");
  assert.equal(block.kind, "code");
  if (block.kind !== "code") return;
  assert.equal(block.text, "npm run build");
});

test("a blank line inside a fence does not split the block", () => {
  // splitting on blank lines first would cut this code block in half.
  const block = first("```\nfirst\n\nsecond\n```");
  assert.equal(block.kind, "code");
  if (block.kind !== "code") return;
  assert.equal(block.text, "first\n\nsecond");
});

test("code content is never inline-formatted", () => {
  const block = first("```\na **b** c\n```");
  assert.equal(block.kind === "code" && block.text, "a **b** c");
});

test("an unterminated fence still yields a code block rather than eating the rest", () => {
  const block = first("```\ndangling");
  assert.equal(block.kind, "code");
  if (block.kind !== "code") return;
  assert.equal(block.text, "dangling");
});

test("a language tag on the fence is accepted and ignored", () => {
  const block = first("```bash\nls\n```");
  assert.equal(block.kind === "code" && block.text, "ls");
});

test("a standalone image is its own block, not a paragraph", () => {
  // The converter emits images alone; wrapping one in <p> nests a figure
  // inside a paragraph.
  const block = first("![A gutter](/blog/a/1-x.jpg)");
  assert.equal(block.kind, "image");
  if (block.kind !== "image") return;
  assert.equal(block.src, "/blog/a/1-x.jpg");
  assert.equal(block.alt, "A gutter");
});

test("an image with text around it stays inline", () => {
  const block = first("Before ![A](/x.jpg) after");
  assert.equal(block.kind, "paragraph");
  if (block.kind !== "paragraph") return;
  assert.ok(block.inline.some((node) => node.kind === "image"));
});

test("an image with an empty alt is still an image block", () => {
  const block = first("![](/blog/a/1-x.jpg)");
  assert.equal(block.kind === "image" && block.alt, "");
});

test("the full converter output shape parses to the documented block set", () => {
  const source = [
    "## Heading",
    "",
    "A paragraph with **bold**.",
    "",
    "- One",
    "  - Nested",
    "",
    "1. First",
    "",
    "> Quoted.",
    "",
    "| A | B |",
    "| --- | --- |",
    "| 1 | 2 |",
    "",
    "```",
    "code",
    "```",
    "",
    "![Alt](/blog/a/1-x.jpg)",
    "",
    "*A caption*",
  ].join("\n");
  assert.deepEqual(kinds(source), [
    "heading",
    "paragraph",
    "list",
    "list",
    "blockquote",
    "table",
    "code",
    "image",
    "paragraph",
  ]);
});

test("a markdown construct interrupted by a tag is not that construct", () => {
  // The grammar runs on the text between tags, so a tag ends whatever markdown
  // run it lands in. Every row asserts the same two things: the words survive,
  // and nothing that was markup in the source is printed as text.
  const table: [string, InlineNode[]][] = [
    // A mark may still BRACKET a tag, because the run either side of it is one
    // run: the `**` opens in one text node and closes in another. `strong`
    // holds a plain string, so the mark yields to what it wrapped rather than
    // printing its own asterisks.
    [
      "**a <b>bold</b> c** after",
      [
        { kind: "text", value: "a " },
        { kind: "strong", value: "bold" },
        { kind: "text", value: " c after" },
      ],
    ],
    // A label may hold a tag; a destination may not.
    ["[a <b>b</b> c](/x)", [{ kind: "link", text: "a b c", href: "/x" }]],
    ["![a <b>b</b> c](/i.jpg)", [{ kind: "image", alt: "a b c", src: "/i.jpg" }]],
    // An unterminated mark is punctuation and prints as written, which is what
    // it was in the source and what every markdown renderer does with it.
    ["**a <b>b</b>", [{ kind: "text", value: "**a " }, { kind: "strong", value: "b" }]],
  ];
  for (const [source, expected] of table) {
    assert.deepEqual(parseInline(source), expected, source);
    assert.ok(!visibleText(parseInline(source)).includes("<"), source);
  }
});

test("text is decoded exactly once, wherever it came from", () => {
  // An attribute is decoded by the scanner and body text by the grammar, so an
  // attribute value that re-enters the text stream is decoded twice and loses a
  // level: `A &amp;amp; B` became `A & B` instead of `A &amp; B`.
  const table: [string, InlineNode[]][] = [
    [
      '<img src="/i.jpg" alt="A &amp;amp; B">',
      [{ kind: "image", src: "/i.jpg", alt: "A &amp; B" }],
    ],
    // The same alt, reached through the refused-src fallback, where it becomes
    // the only text the image carried.
    [
      '<img src="tel:x" alt="A &amp;amp; B">',
      [{ kind: "text", value: "A &amp; B" }],
    ],
    ['<p>a &amp;amp; b</p>', [{ kind: "text", value: "a &amp; b" }]],
    ['<a href="/x">A &amp;amp; B</a>', [{ kind: "link", text: "A &amp; B", href: "/x" }]],
    ["A &amp;amp; B", [{ kind: "text", value: "A &amp; B" }]],
    // An alt is an attribute, not body text, so markdown never runs on one —
    // the same reason the grammar never runs on an href.
    [
      '<img src="/i.jpg" alt="**Alt**">',
      [{ kind: "image", src: "/i.jpg", alt: "**Alt**" }],
    ],
    // The markdown spelling puts the alt in body text, where marks DO resolve.
    ["![**Alt**](/i.jpg)", [{ kind: "image", alt: "Alt", src: "/i.jpg" }]],
  ];
  for (const [source, expected] of table) {
    assert.deepEqual(parseInline(source), expected, source);
  }
});

test("a paragraph element is a paragraph, and its text is read for marks only", () => {
  // Block-level markdown is read where a block could begin, which is between
  // tags. Inside a `<p>` the block is already decided, so a line that opens with
  // a marker is that paragraph's own content — which is what prettier-formatted
  // and CMS-exported bodies are full of.
  const inside = parseBlocks("<p>## Not a heading</p><p>- not a list</p>");
  assert.deepEqual(inside.map((block) => block.kind), ["paragraph", "paragraph"]);
  const between = parseBlocks("<p>Lead.</p>\n\n## A heading\n\n- a list");
  assert.deepEqual(
    between.map((block) => (block.kind === "heading" ? `heading:${block.level}` : block.kind)),
    ["paragraph", "heading:2", "list"],
  );
});

test("a body stays linear, however it is malformed", () => {
  // Every delimiter the grammar scans for is a construct a body can repeat for
  // free, so each has to cost its own scan and not the whole tail. Asserted as
  // a growth ratio, not a stopwatch: a wall-clock bound passes a quadratic on a
  // fast machine, and both shapes below WERE quadratic (a 128KB run of `[`
  // took 3.1s, a 246KB `<pre>` holding markup took 0.9s).
  const shapes: [string, (size: number) => string][] = [
    // A closer exists, so the bound cannot short-circuit; only not rescanning can.
    ["unclosed brackets", (size) => "[".repeat(size) + "a] )"],
    ["unclosed images", (size) => "![".repeat(size / 2) + "a] )"],
    ["unclosed destinations", (size) => "[a](".repeat(size / 4)],
    // `textOf` used to join its accumulator once per node of the subtree.
    ["markup inside a pre", (size) => `<pre>${"<p>x</p>\n".repeat(size / 9)}</pre>`],
    ["marks", (size) => "*".repeat(size)],
    ["backticks", (size) => "`".repeat(size)],
    // The verbatim closer walks constructs to stay in text position, so each of
    // these makes it walk: a span that never closes, one that closes past many
    // tags, and delimiters it must refuse.
    ["a span that never closes", (size) => `\`x ${"a".repeat(size)}`],
    ["a span closing past tags", (size) => `\`x ${"<b>y</b>".repeat(size / 8)}\``],
    ["backticks in attributes", (size) => '<p title="`">t</p>'.repeat(size / 18)],
    ["backticks beside dropped tags", (size) => "`x <script>a</script> ".repeat(size / 21)],
    ["table rows", (size) => "| a |\n".repeat(size / 6)],
  ];
  const once = (source: string): number => {
    const started = process.hrtime.bigint();
    assert.ok(Array.isArray(parseBlocks(source)));
    return Number(process.hrtime.bigint() - started) / 1e6;
  };
  // Best of three. The test files run concurrently, so a single sample measures
  // the scheduler as much as the parser; the minimum is the run that was least
  // interrupted, which is the one that reflects the algorithm.
  const elapsed = (source: string): number =>
    Math.min(once(source), once(source), once(source));
  for (const [name, build] of shapes) {
    // Warm the JIT on this shape so the ratio measures the algorithm.
    once(build(16_000));
    const small = Math.max(elapsed(build(32_000)), 0.5);
    const large = elapsed(build(128_000));
    // Four times the input. Linear measures 2-6x here; the two shapes that were
    // quadratic measured ~15x for the same step. 10 separates them with room
    // for a loaded CI machine, and the absolute bound catches a regression that
    // is merely slow rather than superlinear.
    assert.ok(large / small < 10, `${name}: 4x the input cost ${(large / small).toFixed(1)}x`);
    assert.ok(large < 1_000, `${name}: 128k took ${large.toFixed(0)}ms`);
  }
});

test("empty and whitespace-only sources yield no blocks", () => {
  assert.deepEqual(parseBlocks(""), []);
  assert.deepEqual(parseBlocks("   \n\n  "), []);
});

test("every block kind the parser can emit is in the documented set", () => {
  const documented = new Set([
    "heading",
    "paragraph",
    "list",
    "blockquote",
    "table",
    "code",
    "image",
  ]);
  const source = [
    "## H",
    "",
    "p",
    "",
    "- l",
    "",
    "> q",
    "",
    "| A |",
    "| --- |",
    "",
    "```",
    "c",
    "```",
    "",
    "![a](/i.jpg)",
  ].join("\n");
  for (const kind of kinds(source)) {
    assert.ok(documented.has(kind), `undocumented block kind: ${kind}`);
  }
});
