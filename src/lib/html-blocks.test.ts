import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { parseFrontmatter } from "./blog.ts";
import { parseBlocks, type Block, type InlineNode, type ListItem } from "./markdown.ts";

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__/blog-bodies");

function fixtureBody(name: string): string {
  return parseFrontmatter(readFileSync(join(FIXTURE_DIR, name), "utf8")).body;
}

function kinds(blocks: Block[]): string[] {
  return blocks.map((block) => block.kind);
}

function listText(
  items: ListItem[],
  fromInline: (nodes: InlineNode[]) => string[],
): string[] {
  return items.flatMap((item) => [
    ...fromInline(item.inline),
    ...item.children.flatMap((group) => listText(group.items, fromInline)),
  ]);
}

/** Every string a reader can end up seeing, from every block kind. */
function renderedText(blocks: Block[]): string[] {
  const fromInline = (nodes: InlineNode[]): string[] =>
    nodes.map((node) => {
      switch (node.kind) {
        case "link":
          return `${node.text} ${node.href}`;
        case "image":
          return node.alt;
        default:
          return node.value;
      }
    });
  return blocks.flatMap((block) => {
    switch (block.kind) {
      case "paragraph":
      case "heading":
        return fromInline(block.inline);
      case "list":
        return listText(block.items, fromInline);
      case "blockquote":
        return block.lines.flatMap(fromInline);
      case "table":
        return [block.header, ...block.rows].flatMap((row) => row.flatMap(fromInline));
      case "code":
        return [block.text];
      default:
        return [block.alt];
    }
  });
}

function paragraphText(block: Block): string {
  assert.equal(block.kind, "paragraph");
  if (block.kind !== "paragraph") return "";
  return block.inline.map((node) => (node.kind === "text" ? node.value : "")).join("");
}

/* -------------------------------------------------------------------------- */
/* One path                                                                    */
/* -------------------------------------------------------------------------- */

test("every body shape keeps its own structure, with nothing to route", () => {
  // These are the bodies the deleted per-body detector had to classify, and the
  // classification is what it kept getting wrong. Nothing classifies them now:
  // the tags give the blocks and the text between them gives the rest, so the
  // assertion is the structure itself rather than which parser ran.
  // A third column is the text the reader is expected to see, for the rows
  // where that is the whole point.
  const table: [string, string[], string?][] = [
    ["<p>x</p>", ["paragraph"]],
    ["  <div>x</div>", ["paragraph"]],
    ["prose\n<h2>Later</h2>", ["paragraph", "heading"]],
    ['<script type="application/ld+json">{}</script><p>x</p>', ["paragraph"]],
    ["<table><tr><td>a</td></tr></table>", ["table"]],
    ["Plain markdown.", ["paragraph"]],
    ['Prose with an <a href="/x">inline link</a> in it.', ["paragraph"]],
    // A `<` that opens no tag is arithmetic, and stays exactly as written.
    ["Costs 5 < 6 and 7 > 3.", ["paragraph"], "Costs 5 < 6 and 7 > 3."],
    ["", []],
    // An unknown wrapper is markup whatever it is called: #58 finding 5, where
    // refusing to route it left the whole body rendering as escaped source.
    ["<marquee>x</marquee>", ["paragraph"]],
    ["<article-body><p>x</p></article-body>", ["paragraph"]],
    ['<a href="/x">A link opening a markdown paragraph.</a>', ["paragraph"]],
    ["<strong>Bold lead-in</strong> then prose.", ["paragraph"]],
    // The body whose two grammars disagreed, which the detector had to send
    // wholesale to one of them. Both are read now, each where it applies.
    ['Intro.\n\n<div class="cta">Call now</div>\n\n## Heading\n\n- one', [
      "paragraph",
      "paragraph",
      "heading",
      "list",
    ]],
    ["<p>Real HTML.</p>\n\n<p>Still HTML.</p>", ["paragraph", "paragraph"]],
  ];
  for (const [source, expected, visible] of table) {
    const blocks = parseBlocks(source);
    assert.deepEqual(kinds(blocks), expected, JSON.stringify(source));
    for (const text of renderedText(blocks)) {
      if (visible === undefined) {
        assert.ok(!text.includes("<"), `${source}: "<" reached the reader: ${text}`);
      }
      assert.ok(!text.startsWith("#"), `${source}: a marker reached the reader: ${text}`);
    }
    if (visible !== undefined) assert.equal(renderedText(blocks).join(""), visible, source);
  }
});

test("an HTML body resolves the markdown marks inside its text", () => {
  const blocks = parseBlocks(
    "<p>markdown **bold** inside html and a [link](/pricing).</p>",
  );
  assert.deepEqual(kinds(blocks), ["paragraph"]);
  if (blocks[0].kind !== "paragraph") return;
  assert.deepEqual(blocks[0].inline, [
    { kind: "text", value: "markdown " },
    { kind: "strong", value: "bold" },
    { kind: "text", value: " inside html and a " },
    { kind: "link", text: "link", href: "/pricing" },
    { kind: "text", value: "." },
  ]);
});

test("a body claiming both grammars keeps its markdown structure", () => {
  const blocks = parseBlocks('Intro.\n\n<div class="cta">Call now</div>\n\n## Heading\n\n- one\n- two');
  assert.deepEqual(kinds(blocks), ["paragraph", "paragraph", "heading", "list"]);
  for (const text of renderedText(blocks)) {
    assert.ok(!text.includes("<"), text);
    assert.ok(!text.startsWith("##"), text);
  }
});

/* -------------------------------------------------------------------------- */
/* Adversarial table                                                           */
/* -------------------------------------------------------------------------- */

test("adversarial HTML bodies", () => {
  const rows: {
    name: string;
    source: string;
    /** Set only where the expected TEXT legitimately contains `<` or `>`,
     * which is to say where a decoded entity produced it. */
    decodesAngleBrackets?: true;
    check: (blocks: Block[]) => void;
  }[] = [
    {
      name: "an unclosed tag still yields its block",
      source: "<p>Unclosed",
      check: (blocks) => {
        assert.deepEqual(kinds(blocks), ["paragraph"]);
        assert.equal(paragraphText(blocks[0]), "Unclosed");
      },
    },
    {
      name: "nested wrapper divs collapse to one paragraph",
      source: "<div><div><p>x</p></div></div>",
      check: (blocks) => {
        assert.deepEqual(kinds(blocks), ["paragraph"]);
        assert.equal(paragraphText(blocks[0]), "x");
      },
    },
    {
      name: "a script is dropped whole, never unwrapped",
      source: "<script>alert(1)</script><p>x</p>",
      check: (blocks) => {
        assert.deepEqual(kinds(blocks), ["paragraph"]);
        assert.equal(paragraphText(blocks[0]), "x");
        assert.ok(!renderedText(blocks).join("").includes("alert"));
      },
    },
    {
      name: "style, template and noscript are dropped whole too",
      source:
        "<style>p{color:red}</style><template><p>t</p></template><noscript><p>n</p></noscript><p>x</p>",
      check: (blocks) => {
        assert.deepEqual(kinds(blocks), ["paragraph"]);
        assert.equal(paragraphText(blocks[0]), "x");
      },
    },
    {
      name: "an unterminated script drops the rest of the body rather than leaking it",
      source: "<p>before</p><script>never closed <p>after</p>",
      check: (blocks) => {
        assert.deepEqual(kinds(blocks), ["paragraph"]);
        assert.equal(paragraphText(blocks[0]), "before");
      },
    },
    {
      name: "a comment is dropped, contents included",
      source: "<!-- ![x](y) --><p>real</p>",
      check: (blocks) => {
        assert.deepEqual(kinds(blocks), ["paragraph"]);
        assert.equal(paragraphText(blocks[0]), "real");
      },
    },
    {
      name: "entities are decoded",
      decodesAngleBrackets: true,
      source: "<p>a &amp; b &lt;c&gt; &#39;q&#39; &#x2014; &nbsp;end &unknownentity;</p>",
      check: (blocks) => {
        assert.equal(paragraphText(blocks[0]), "a & b <c> 'q' —  end &unknownentity;");
      },
    },
    {
      name: "&amp;lt; decodes once, not twice",
      source: "<p>&amp;lt;</p>",
      check: (blocks) => assert.equal(paragraphText(blocks[0]), "&lt;"),
    },
    {
      name: "an unknown tag is unwrapped, children kept",
      source: "<marquee><p>x</p></marquee>",
      check: (blocks) => {
        assert.deepEqual(kinds(blocks), ["paragraph"]);
        assert.equal(paragraphText(blocks[0]), "x");
      },
    },
    {
      name: "a table with no thead still parses",
      source: "<table><tr><td>a</td></tr></table>",
      check: (blocks) => {
        assert.deepEqual(kinds(blocks), ["table"]);
        if (blocks[0].kind !== "table") return;
        // A row of `td` is data. Promoting it would invent a header, and
        // padding an absent header to the table's width would put a row of
        // blank bordered cells above it, so it stays empty.
        assert.deepEqual(blocks[0].header, []);
        assert.equal(blocks[0].rows.length, 1);
        assert.deepEqual(blocks[0].rows[0][0], [{ kind: "text", value: "a" }]);
      },
    },
    {
      name: "a th-only first row is the header even with no thead",
      source: "<table><tr><th>A</th></tr><tr><td>1</td></tr></table>",
      check: (blocks) => {
        assert.equal(blocks[0].kind, "table");
        if (blocks[0].kind !== "table") return;
        assert.deepEqual(blocks[0].header[0], [{ kind: "text", value: "A" }]);
        assert.equal(blocks[0].rows.length, 1);
      },
    },
    {
      name: "a nested list becomes a child group, not a sibling",
      source: "<ul><li>a<ol><li>b</li></ol></li></ul>",
      check: (blocks) => {
        assert.deepEqual(kinds(blocks), ["list"]);
        if (blocks[0].kind !== "list") return;
        assert.equal(blocks[0].ordered, false);
        assert.equal(blocks[0].items.length, 1);
        assert.deepEqual(blocks[0].items[0].inline, [{ kind: "text", value: "a" }]);
        assert.equal(blocks[0].items[0].children.length, 1);
        assert.equal(blocks[0].items[0].children[0].ordered, true);
        assert.deepEqual(blocks[0].items[0].children[0].items[0].inline, [
          { kind: "text", value: "b" },
        ]);
      },
    },
    {
      name: "a mark inside a tag resolves, because the text between tags is markdown",
      source: "<p>markdown **bold** inside html</p>",
      check: (blocks) => {
        // The pipeline emits `**[text](href)**` in mixed bodies and shipping
        // the asterisks at the reader was the bug.
        assert.deepEqual(blocks[0].kind === "paragraph" && blocks[0].inline, [
          { kind: "text", value: "markdown " },
          { kind: "strong", value: "bold" },
          { kind: "text", value: " inside html" },
        ]);
      },
    },
    {
      name: "a fence inside raw text keeps its info string",
      source: "<pre>\n```bash\nls -la\n```\n</pre>",
      check: (blocks) => {
        // Review round 3. `verbatimSource` used to REBUILD a fence as three
        // backticks plus the content, which silently dropped whatever the
        // opening line said — here the `bash`. The source is carried now, so
        // there is nothing to rebuild and nothing to drop.
        assert.equal(blocks[0].kind === "code" && blocks[0].text, "```bash\nls -la\n```");
      },
    },
    {
      name: "a backtick inside raw text is a character, not a delimiter",
      source: "<pre>a `b` c</pre><p>Use <code>x `y` z</code> here</p>",
      check: (blocks) => {
        // Verbatim regions are lexed before tags, so one can land inside a
        // `<pre>`. There it is raw text, and dropping its delimiters would
        // silently edit a code sample.
        assert.deepEqual(kinds(blocks), ["code", "paragraph"]);
        assert.equal(blocks[0].kind === "code" && blocks[0].text, "a `b` c");
        assert.deepEqual(blocks[1].kind === "paragraph" && blocks[1].inline, [
          { kind: "text", value: "Use " },
          { kind: "code", value: "x `y` z" },
          { kind: "text", value: " here" },
        ]);
      },
    },
    {
      name: "empty and whitespace-only bodies yield no blocks",
      source: "   ",
      check: (blocks) => assert.deepEqual(blocks, []),
    },
    /* Two variants nobody asked for, from the self-attack question "what is the
       next way markup leaks?" */
    {
      name: "an attribute value containing > does not end the tag early",
      source: '<p title="a > b" data-x="c>d">visible</p>',
      check: (blocks) => {
        assert.deepEqual(kinds(blocks), ["paragraph"]);
        assert.equal(paragraphText(blocks[0]), "visible");
      },
    },
    {
      name: "a table inside a td does not donate rows to the outer table",
      source:
        "<table><thead><tr><th>H</th></tr></thead><tbody><tr><td><table><tr><td>inner</td></tr></table></td></tr></tbody></table>",
      check: (blocks) => {
        assert.deepEqual(kinds(blocks), ["table"]);
        if (blocks[0].kind !== "table") return;
        assert.equal(blocks[0].header.length, 1);
        assert.equal(blocks[0].rows.length, 1);
        assert.deepEqual(blocks[0].rows[0][0], [{ kind: "text", value: "inner" }]);
      },
    },
    {
      name: "an unquoted attribute containing markup characters is not text",
      source: "<p class=lead>only this</p>",
      check: (blocks) => assert.equal(paragraphText(blocks[0]), "only this"),
    },
    {
      name: "implied end tags make siblings, not nests",
      source: "<p>a<p>b<ul><li>one<li>two</ul>",
      check: (blocks) => {
        assert.deepEqual(kinds(blocks), ["paragraph", "paragraph", "list"]);
        if (blocks[2].kind !== "list") return;
        assert.equal(blocks[2].items.length, 2);
      },
    },
    {
      name: "a stray close tag is discarded, not rendered",
      source: "</div><p>x</p></span>",
      check: (blocks) => {
        assert.deepEqual(kinds(blocks), ["paragraph"]);
        assert.equal(paragraphText(blocks[0]), "x");
      },
    },
    {
      name: "tag names are case-insensitive",
      source: "<P>X</P><H2>Head</H2>",
      check: (blocks) => assert.deepEqual(kinds(blocks), ["paragraph", "heading"]),
    },
    {
      name: "a bare < that opens no tag is literal text",
      decodesAngleBrackets: true,
      source: "<p>5 < 6 and a &lt; b</p>",
      check: (blocks) => assert.equal(paragraphText(blocks[0]), "5 < 6 and a < b"),
    },
    {
      name: "emphasis wrapping a link keeps the link",
      source: '<p><strong><a href="/x">Book now</a></strong></p>',
      check: (blocks) => {
        assert.equal(blocks[0].kind, "paragraph");
        if (blocks[0].kind !== "paragraph") return;
        assert.deepEqual(blocks[0].inline, [{ kind: "link", text: "Book now", href: "/x" }]);
      },
    },
    {
      name: "a lone image is its own block, an image with text is inline",
      source: '<p><img src="/a.jpg" alt="A"></p><p>see <img src="/b.jpg" alt="B"> here</p>',
      check: (blocks) => {
        assert.deepEqual(kinds(blocks), ["image", "paragraph"]);
        if (blocks[1].kind !== "paragraph") return;
        assert.ok(blocks[1].inline.some((node) => node.kind === "image"));
      },
    },
    {
      name: "a figure is unwrapped and its caption survives",
      source:
        '<figure><img src="/a.jpg" alt="A"><figcaption>The caption.</figcaption></figure>',
      check: (blocks) => {
        assert.deepEqual(kinds(blocks), ["image", "paragraph"]);
        assert.equal(paragraphText(blocks[1]), "The caption.");
      },
    },
    {
      name: "a table caption is kept rather than swallowed",
      source: "<table><caption>Costs</caption><tr><th>A</th></tr></table>",
      check: (blocks) => {
        assert.deepEqual(kinds(blocks), ["paragraph", "table"]);
        assert.equal(paragraphText(blocks[0]), "Costs");
      },
    },
    {
      name: "pre keeps its text verbatim and is not inline-formatted",
      source: "<pre><code>a **b** c\n  indented</code></pre>",
      check: (blocks) => {
        assert.deepEqual(kinds(blocks), ["code"]);
        if (blocks[0].kind !== "code") return;
        assert.equal(blocks[0].text, "a **b** c\n  indented");
      },
    },
    {
      name: "a blockquote keeps one line per inner block",
      source: "<blockquote><p>One.</p><p>Two.</p></blockquote>",
      check: (blocks) => {
        assert.deepEqual(kinds(blocks), ["blockquote"]);
        if (blocks[0].kind !== "blockquote") return;
        assert.equal(blocks[0].lines.length, 2);
      },
    },
    {
      name: "h4 through h6 are level 3 headings",
      source: "<p>lead</p><h4>Four</h4><h5>Five</h5><h6>Six</h6>",
      check: (blocks) => {
        assert.deepEqual(kinds(blocks), ["paragraph", "heading", "heading", "heading"]);
        for (const block of blocks.slice(1)) {
          assert.equal(block.kind === "heading" && block.level, 3);
        }
      },
    },
    {
      name: "a leading h1 is dropped, a later one is a heading",
      source: "<h1>Title</h1><p>Body</p><h1>Later</h1>",
      check: (blocks) => {
        assert.deepEqual(kinds(blocks), ["paragraph", "heading"]);
        assert.equal(blocks[1].kind === "heading" && blocks[1].level, 2);
      },
    },
    {
      name: "only safe URL schemes become links; the words always survive",
      source:
        '<p><a href="javascript:alert(1)">A</a><a href=" JaVaScript:alert(1)">B</a>' +
        '<a href="vbscript:x">C</a><a href="data:text/html,x">D</a>' +
        '<a href="/ok">E</a><a href="https://e.com">F</a><a href="mailto:a@b.c">G</a>' +
        '<a href="tel:555">H</a><a href="#frag">I</a><a href="//cdn.e.com/x">J</a></p>',
      check: (blocks) => {
        assert.deepEqual(kinds(blocks), ["paragraph"]);
        if (blocks[0].kind !== "paragraph") return;
        const links = blocks[0].inline.filter((node) => node.kind === "link");
        assert.deepEqual(
          links.map((node) => (node.kind === "link" ? node.text : "")),
          ["E", "F", "G", "H", "I", "J"],
        );
        // Refusing a scheme costs the anchor, never the words inside it.
        assert.equal(
          blocks[0].inline
            .map((node) => (node.kind === "text" ? node.value : node.kind === "link" ? node.text : ""))
            .join(""),
          "ABCDEFGHIJ",
        );
      },
    },
    {
      name: "a close tag inside a quoted attribute is a string, not a close tag",
      source: '<template><p title="</template>">LEAK</p></template><p>keep</p>',
      check: (blocks) => {
        assert.deepEqual(kinds(blocks), ["paragraph"]);
        assert.equal(paragraphText(blocks[0]), "keep");
      },
    },
    {
      name: "the same holds for noscript, and for a nested dropped element",
      source: '<noscript><p title="</noscript>">LEAK</p></noscript><p>keep</p>',
      check: (blocks) => {
        assert.deepEqual(kinds(blocks), ["paragraph"]);
        assert.equal(paragraphText(blocks[0]), "keep");
      },
    },
    {
      name: "a dropped element nested inside another cannot end the outer one",
      source: '<template><script>var s = "</template>";</script>LEAK</template><p>keep</p>',
      check: (blocks) => {
        assert.deepEqual(kinds(blocks), ["paragraph"]);
        assert.equal(paragraphText(blocks[0]), "keep");
      },
    },
    {
      name: "a quoted attribute containing < is still read to its closing quote",
      source: '<p title="a < b and a > b" data-x="c>d">visible</p>',
      check: (blocks) => {
        assert.deepEqual(kinds(blocks), ["paragraph"]);
        assert.equal(paragraphText(blocks[0]), "visible");
      },
    },
    {
      name: "a self-closing script is not self-closing, and its content is dropped",
      source: "<p>a</p><script/>alert(1)</script><p>b</p>",
      check: (blocks) => {
        assert.deepEqual(kinds(blocks), ["paragraph", "paragraph"]);
        assert.ok(!renderedText(blocks).join("").includes("alert"));
      },
    },
    {
      name: "a quoted list keeps its nested items",
      source: "<blockquote><ul><li>Parent<ul><li>Child</li><li>Second</li></ul></li></ul></blockquote>",
      check: (blocks) => {
        assert.deepEqual(kinds(blocks), ["blockquote"]);
        if (blocks[0].kind !== "blockquote") return;
        assert.deepEqual(
          blocks[0].lines.map((line) =>
            line.map((node) => (node.kind === "text" ? node.value : "")).join(""),
          ),
          ["Parent", "Child", "Second"],
        );
      },
    },
    {
      name: "a quoted table keeps every cell",
      source: "<blockquote><table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table></blockquote>",
      check: (blocks) => {
        assert.deepEqual(kinds(blocks), ["blockquote"]);
        if (blocks[0].kind !== "blockquote") return;
        const text = blocks[0].lines
          .flat()
          .map((node) => (node.kind === "text" ? node.value : ""))
          .join("");
        for (const cell of ["A", "B", "1", "2"]) assert.ok(text.includes(cell), cell);
      },
    },
    {
      name: "an image with a refused src keeps its alt words",
      source: '<p><img src="javascript:alert(1)" alt="Fallback words"> after</p>',
      check: (blocks) => {
        assert.deepEqual(kinds(blocks), ["paragraph"]);
        assert.equal(paragraphText(blocks[0]), "Fallback words after");
      },
    },
    {
      name: "an anchor wrapping only an image keeps its href",
      source: '<p><a href="/x"><img src="/i.png" alt="Spring sale"></a></p>',
      check: (blocks) => {
        assert.deepEqual(kinds(blocks), ["paragraph"]);
        if (blocks[0].kind !== "paragraph") return;
        assert.deepEqual(blocks[0].inline, [
          { kind: "link", text: "Spring sale", href: "/x" },
        ]);
      },
    },
    {
      name: "an anchor around an image with no alt keeps the image",
      source: '<p><a href="/x"><img src="/i.png" alt=""></a></p>',
      check: (blocks) => assert.deepEqual(kinds(blocks), ["image"]),
    },
    {
      name: "stray list items outside a list do not run together",
      source: "<li>c<li>d",
      check: (blocks) => {
        assert.deepEqual(kinds(blocks), ["paragraph"]);
        assert.equal(paragraphText(blocks[0]), "c d");
      },
    },
    {
      name: "stray table cells outside a table do not run together",
      source: "<td>c</td><td>d</td>",
      check: (blocks) => assert.equal(paragraphText(blocks[0]), "c d"),
    },
    {
      name: "a body that is only its title still renders the title",
      source: "<h1>Only heading</h1>",
      check: (blocks) => {
        assert.deepEqual(kinds(blocks), ["heading"]);
        assert.equal(blocks[0].kind === "heading" && blocks[0].level, 2);
      },
    },
    {
      name: "a leading blockquote does not swallow its own heading",
      source: "<blockquote><h1>Q</h1></blockquote><p>Body</p>",
      check: (blocks) => {
        assert.deepEqual(kinds(blocks), ["blockquote", "paragraph"]);
        if (blocks[0].kind !== "blockquote") return;
        assert.deepEqual(blocks[0].lines[0], [{ kind: "text", value: "Q" }]);
      },
    },
    {
      name: "a ragged row wider than the header keeps its cell",
      source:
        "<table><thead><tr><th>A</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>",
      check: (blocks) => {
        assert.equal(blocks[0].kind, "table");
        if (blocks[0].kind !== "table") return;
        assert.equal(blocks[0].header.length, 2);
        assert.deepEqual(blocks[0].rows[0][1], [{ kind: "text", value: "2" }]);
      },
    },
    {
      name: "text loose between blocks becomes its own paragraph",
      source: "<div><p>capsule</p></div>Loose sentence.<h2>Next</h2>",
      check: (blocks) => {
        assert.deepEqual(kinds(blocks), ["paragraph", "paragraph", "heading"]);
        assert.equal(paragraphText(blocks[1]), "Loose sentence.");
      },
    },
  ];

  for (const row of rows) {
    const blocks = parseBlocks(row.source);
    if (row.decodesAngleBrackets !== true) {
      for (const text of renderedText(blocks)) {
        assert.ok(!text.includes("<"), `${row.name}: "<" reached the reader: ${text}`);
        assert.ok(!text.includes(">"), `${row.name}: ">" reached the reader: ${text}`);
      }
    }
    row.check(blocks);
  }
});

test("a large body completes without catastrophic backtracking", () => {
  const paragraph =
    '<p class="lead" data-x="y">Text with an <a href="https://example.com/a?b=1&amp;c=2">' +
    "link</a> and <strong>bold</strong> and an entity &amp; inside.</p>";
  const source = paragraph.repeat(Math.ceil(200_000 / paragraph.length));
  assert.ok(source.length >= 200_000);
  const started = Date.now();
  const blocks = parseBlocks(source);
  assert.ok(blocks.length > 500);
  assert.ok(Date.now() - started < 5_000, "parse took too long");
});

/* -------------------------------------------------------------------------- */
/* Real corpus                                                                 */
/* -------------------------------------------------------------------------- */

const HTML_FIXTURES = [
  // my-electrician-fl/content/blog/aluminum-wiring-florida-homes.md
  "electrician-html.md",
  // qbc-site/content/blog/auto-distributor-order-entry.md
  "qbc-tables.md",
  // cosello-construction/content/blog/ada-compliant-commercial-doors-upgrade-guide.md
  "cosello-capsule.md",
];

const MARKDOWN_FIXTURES = [
  // maid-ok-website/content/blog/apartment-cleaning-guide-oklahoma-city-renters.md
  "maid-ok-markdown.md",
  // cap-city/src/content/blog/uber-accident-attorney-texas-rideshare-crash.md
  "cap-city-markdown.md",
];

test("published bodies render as blocks, never as markup", () => {
  for (const name of [...HTML_FIXTURES, ...MARKDOWN_FIXTURES]) {
    const blocks = parseBlocks(fixtureBody(name));
    assert.ok(blocks.length > 3, `${name}: parsed to ${blocks.length} blocks`);
    for (const text of renderedText(blocks)) {
      assert.ok(!text.includes("<"), `${name}: "<" reached the reader: ${text}`);
      assert.ok(!text.includes(">"), `${name}: ">" reached the reader: ${text}`);
      assert.ok(
        !text.includes("application/ld+json"),
        `${name}: JSON-LD reached the reader`,
      );
      assert.ok(!text.includes("schema.org"), `${name}: JSON-LD reached the reader`);
      // Markdown syntax is markup too: `**[text](href)**` is the pipeline's
      // standard CTA and used to print itself at the reader.
      assert.ok(!/\]\((https?:|\/|tel:|mailto:)/.test(text), `${name}: link syntax: ${text}`);
      assert.ok(!text.includes("**"), `${name}: emphasis syntax: ${text}`);
    }
  }
});

test("the HTML fixtures produce the expected block set", () => {
  for (const name of HTML_FIXTURES) {
    const body = fixtureBody(name);
    const seen = new Set(kinds(parseBlocks(body)));
    assert.ok(seen.has("paragraph"), name);
    assert.ok(seen.has("heading"), name);
    assert.ok(seen.has("table"), name);
    assert.ok(seen.has("list"), name);
  }
  // The electrician body inlines a JSON-LD script and carries a figure/img.
  const electrician = parseBlocks(fixtureBody("electrician-html.md"));
  assert.ok(kinds(electrician).includes("image"));
});

test("the markdown fixtures keep their markdown structure", () => {
  for (const name of MARKDOWN_FIXTURES) {
    const body = fixtureBody(name);
    const seen = new Set(kinds(parseBlocks(body)));
    assert.ok(seen.has("paragraph"), name);
    assert.ok(seen.has("heading"), name);
    assert.ok(seen.has("list"), name);
  }
  // cap-city repeats the post title as a leading H1; the template already
  // renders the title, so the duplicate must not reach the page.
  const capCity = parseBlocks(fixtureBody("cap-city-markdown.md"));
  assert.equal(capCity[0].kind, "paragraph");
  const headings = capCity.filter((block) => block.kind === "heading");
  assert.ok(
    !headings.some((block) =>
      block.kind === "heading" &&
      block.inline.some(
        (node) => node.kind === "text" && node.value.startsWith("Uber Accident Attorney"),
      ),
    ),
    "the duplicate H1 title is still rendered",
  );
});
