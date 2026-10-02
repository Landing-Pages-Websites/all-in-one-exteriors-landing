import assert from "node:assert/strict";
import test from "node:test";

import {
  htmlNameOf,
  parityHolds,
  renderedParity,
} from "../src/rendered-parity.js";

/**
 * The claim under test: every difference this comparison normalises away is one
 * a reader cannot see, and every one it keeps is one they can.
 *
 * A normalisation is a hole by construction -- it is a rule for calling two
 * different things the same -- so each row below comes in a pair: the shape the
 * conversion is allowed to produce, and the smallest neighbouring shape it must
 * still refuse. A gate tested only on the first half passes by returning
 * "identical" for everything, which is exactly what a gate that has stopped
 * working does.
 *
 * Each row is a defect this actually caught on All Points Media, named in its
 * `why`, so the table is a record rather than an invention.
 */
function compare(before: string, after: string): boolean {
  return parityHolds(
    renderedParity({
      before: new Map([["index.html", before]]),
      after: new Map([["index.html", after]]),
    }),
  );
}

interface Row {
  readonly why: string;
  readonly before: string;
  /** Shapes the conversion may produce, which must compare equal. */
  readonly allowed: readonly string[];
  /** The nearest shapes it must still refuse. */
  readonly refused: readonly string[];
}

const ROWS: readonly Row[] = [
  {
    why: "an annotation on the element that already held the value",
    before: "<h1>Signage that lasts</h1>",
    allowed: ['<h1 data-gomega-field-id="field_a">Signage that lasts</h1>'],
    refused: [
      '<h1 data-gomega-field-id="field_a">Signage that last</h1>',
      '<h2 data-gomega-field-id="field_a">Signage that lasts</h2>',
    ],
  },
  {
    why: "a span added around a value that shares its element",
    before: "<p>Build a network, <em>fast</em></p>",
    allowed: [
      '<p><span data-gomega-field-id="field_a">Build a network, </span><em>fast</em></p>',
    ],
    refused: [
      // The whitespace defect: the span took the trimmed text and the words ran together.
      '<p><span data-gomega-field-id="field_a">Build a network,</span><em>fast</em></p>',
      '<p><span data-gomega-field-id="field_a">Build a network, </span><em>slow</em></p>',
    ],
  },
  {
    why: "the page-root wrapper, which is a real element the reader cannot see",
    before: "<main><h1>Hello</h1></main>",
    allowed: [
      '<div class="contents" data-gomega-page-id="page_a"><main><h1>Hello</h1></main></div>',
    ],
    refused: [
      '<div class="contents" data-gomega-page-id="page_a"><main><h1>Hello</h1></main></div><footer>x</footer>',
      '<div class="wrapper" data-gomega-page-id="page_a"><main><h1>Hello</h1></main></div>',
    ],
  },
  {
    why: "a value already alone in a bare span keeps it and gains the annotation",
    before: "<a><span>Explore Solutions</span></a>",
    allowed: [
      '<a><span data-gomega-field-id="field_a">Explore Solutions</span></a>',
    ],
    refused: [
      '<a><span data-gomega-field-id="field_a">Explore Solution</span></a>',
    ],
  },
  {
    why: "React's separator, which moves when text stops sitting beside an expression",
    before: "<p>Ten<!-- --> years</p>",
    allowed: ['<p data-gomega-field-id="field_a">Ten years</p>'],
    refused: ["<p>Ten years and more</p>"],
  },
  {
    // Next 14 and Next 16 name bundles differently -- `chunks/672-<hash>.js`
    // against a bare `0atut6a2uuyid.js` -- and a rule shaped like one reported
    // every page of a site built by the other as changed.
    why: "build identity: the build id and bundle names of either shape",
    before:
      '<script src="/_next/static/chunks/0atut6a2uuyid.js"></script>' +
      '<script src="/_next/static/chunks/672-aaaaaaaa1111.js"></script>' +
      '<link href="/_next/static/css/abcdef0123456789.css"/>' +
      '<script src="/_next/static/AbCdEfGhIjKlMnOp/_ssgManifest.js"></script>',
    allowed: [
      '<script src="/_next/static/chunks/9zzqq1x2pp0kd.js"></script>' +
        '<script src="/_next/static/chunks/790-bbbbbbbb2222.js"></script>' +
        '<link href="/_next/static/css/9876543210fedcba.css"/>' +
        '<script src="/_next/static/ZzYyXxWwVvUuTtSs/_ssgManifest.js"></script>',
    ],
    refused: [
      // A page that loads an ADDITIONAL chunk is a different page.
      '<script src="/_next/static/chunks/9zzqq1x2pp0kd.js"></script>' +
        '<script src="/_next/static/chunks/790-bbbbbbbb2222.js"></script>' +
        '<script src="/_next/static/chunks/791-cccccccc3333.js"></script>' +
        '<link href="/_next/static/css/9876543210fedcba.css"/>' +
        '<script src="/_next/static/ZzYyXxWwVvUuTtSs/_ssgManifest.js"></script>',
    ],
  },
  {
    why: "the hydration payload, which restates the markup and is dropped",
    before: '<p>Hello</p><script>self.__next_f.push([1,"old"])</script>',
    allowed: [
      '<p data-gomega-field-id="field_a">Hello</p><script>self.__next_f.push([1,"new"])</script>',
    ],
    refused: ['<p>Goodbye</p><script>self.__next_f.push([1,"old"])</script>'],
  },
];

for (const row of ROWS) {
  test(`allowed: ${row.why}`, () => {
    for (const after of row.allowed) {
      assert.equal(
        compare(row.before, after),
        true,
        `must compare equal:\n${after}`,
      );
    }
  });
  test(`refused: ${row.why}`, () => {
    for (const after of row.refused) {
      assert.equal(
        compare(row.before, after),
        false,
        `must NOT compare equal:\n${after}`,
      );
    }
  });
}

/**
 * A media filename is masked by nothing, and the reason is the opposite of the
 * one that masks a bundle's. A bundle is renamed when unrelated code changes,
 * so its name says nothing; an image's name is a hash of the IMAGE, so it
 * changes only when the picture does. Masking it would let a swapped logo pass.
 */
/**
 * A bundle can sit in a directory named after the route that loads it. Matching
 * only a filename directly under `chunks/` left every dynamic-route page of a
 * real site comparing as a change, which the fixture -- having no dynamic
 * routes -- could not show.
 */
test("a nested route bundle is masked by name and kept by route", () => {
  const before =
    '<script src="/_next/static/chunks/app/(site)/work/%5Bslug%5D/page-2e1c1c3b.js"></script>';
  const after =
    '<script src="/_next/static/chunks/app/(site)/work/%5Bslug%5D/page-cefc2fbc.js"></script>';
  assert.equal(
    compare(before, after),
    true,
    "the hash says nothing a reader sees",
  );
  const elsewhere =
    '<script src="/_next/static/chunks/app/(site)/insights/%5Bslug%5D/page-cefc2fbc.js"></script>';
  assert.equal(
    compare(before, elsewhere),
    false,
    "loading another route's bundle is a different page",
  );
});

test("a different image is a change, though the markup around it is identical", () => {
  const before =
    '<img src="/_next/static/media/logo-old.a1b2c3.svg" alt="Northwind"/>';
  const after =
    '<img src="/_next/static/media/logo-new.d4e5f6.svg" alt="Northwind"/>';
  assert.equal(
    compare(before, after),
    false,
    "a reader sees a different picture",
  );
});

test("the same image through a conversion is not a change", () => {
  const src =
    '<p><img src="/_next/static/media/logo.a1b2c3.svg" alt="Northwind"/></p>';
  assert.equal(
    compare(
      src,
      '<p data-gomega-field-id="field_a"><img src="/_next/static/media/logo.a1b2c3.svg" alt="Northwind"/></p>',
    ),
    true,
    "an unchanged image keeps its hash, so nothing has to be masked for it",
  );
});

/**
 * A page rendered on demand writes no file, so it is absent from BOTH sides and
 * says nothing by being absent. All Points Media's /contact is dynamic because
 * of its form, and a run reporting every page identical had never looked at it.
 */
test("a declared route with no prerendered HTML fails, it is not passed over", () => {
  const report = renderedParity({
    before: new Map([["index.html", "<p>a</p>"]]),
    after: new Map([["index.html", "<p>a</p>"]]),
    declaredRoutes: [
      { kind: "static", path: "/" },
      { kind: "static", path: "/contact" },
    ],
  });
  assert.deepEqual(report.uncompared, ["/contact"]);
  assert.equal(report.identical, 1, "the page it could compare still counts");
  assert.equal(
    parityHolds(report),
    false,
    "every page identical and one never looked at is not a pass",
  );
});

test("fetching the missing route from a running build clears it", () => {
  const report = renderedParity({
    before: new Map([
      ["index.html", "<p>a</p>"],
      ["contact.html", "<p>form</p>"],
    ]),
    after: new Map([
      ["index.html", "<p>a</p>"],
      ["contact.html", "<p>form</p>"],
    ]),
    declaredRoutes: [
      { kind: "static", path: "/" },
      { kind: "static", path: "/contact" },
    ],
  });
  assert.deepEqual(report.uncompared, []);
  assert.equal(parityHolds(report), true);
});

/**
 * A stylesheet is compared as an ordered sequence carrying its at-rule context,
 * because a flat multiset of rule text cannot see either of these: the text of
 * `.hero{color:red}` is the same inside an `@media` block and outside it, and
 * two rules swapped are the same two rules.
 */
test("a rule moved into an at-rule is a change, though its text is identical", () => {
  const report = renderedParity({
    before: new Map([["index.html", "<p>a</p>"]]),
    after: new Map([["index.html", "<p>a</p>"]]),
    stylesheets: {
      before: [".hero{color:red}"],
      after: ["@media (min-width:40em){.hero{color:red}}"],
    },
  });
  assert.equal(parityHolds(report), false, "the cascade differs");
  assert.deepEqual(report.stylesheetsChanged, [".hero{color:red}"]);
});

test("two rules swapped is a change, though the set is identical", () => {
  const report = renderedParity({
    before: new Map([["index.html", "<p>a</p>"]]),
    after: new Map([["index.html", "<p>a</p>"]]),
    stylesheets: {
      before: [".a{color:red}.b{color:blue}"],
      after: [".b{color:blue}.a{color:red}"],
    },
  });
  assert.equal(
    parityHolds(report),
    false,
    "later rules win, so order is meaning",
  );
});

test("a stylesheet is compared as rules, since its name is masked", () => {
  const report = renderedParity({
    before: new Map([["index.html", "<p>a</p>"]]),
    after: new Map([["index.html", "<p>a</p>"]]),
    stylesheets: {
      before: [".a{color:red}.b{color:blue}"],
      after: [".a{color:red}.b{color:blue}.contents{display:contents}"],
    },
  });
  assert.deepEqual(report.stylesheetRulesAdded, [
    ".contents{display:contents}",
  ]);
  assert.deepEqual(report.stylesheetsChanged, []);
  assert.equal(parityHolds(report), true, "an added rule is not a failure");
});

test("a REMOVED stylesheet rule is a failure", () => {
  const report = renderedParity({
    before: new Map([["index.html", "<p>a</p>"]]),
    after: new Map([["index.html", "<p>a</p>"]]),
    stylesheets: { before: [".a{color:red}"], after: [""] },
  });
  assert.deepEqual(report.stylesheetsChanged, [".a{color:red}"]);
  assert.equal(parityHolds(report), false);
});

test("a page that stopped being rendered is a failure", () => {
  const report = renderedParity({
    before: new Map([
      ["index.html", "<p>a</p>"],
      ["about.html", "<p>b</p>"],
    ]),
    after: new Map([["index.html", "<p>a</p>"]]),
  });
  assert.deepEqual(report.missing, ["about.html"]);
  assert.equal(parityHolds(report), false);
});

test("a route names the file its HTML is written to", () => {
  assert.equal(htmlNameOf("/"), "index.html");
  assert.equal(htmlNameOf("/about"), "about.html");
  assert.equal(
    htmlNameOf("/innovation/boardwalk"),
    "innovation/boardwalk.html",
  );
});

/**
 * A contract page is static or GENERATED, and a generated one stands for many
 * URLs rather than for a file. Reading `path` off one gives `undefined`, and
 * the documented command crashed on `.replace` rather than saying anything.
 * One file cannot answer for a pattern, so it is reported and failed.
 */
test("a generated route is reported, not crashed on", () => {
  const report = renderedParity({
    before: new Map([["index.html", "<p>a</p>"]]),
    after: new Map([["index.html", "<p>a</p>"]]),
    declaredRoutes: [
      { kind: "static", path: "/" },
      { kind: "generated", pattern: "/work/[slug]" },
    ],
  });
  assert.deepEqual(report.unsupported, ["/work/[slug]"]);
  assert.deepEqual(report.uncompared, [], "a pattern is not a missing file");
  assert.equal(parityHolds(report), false);
});

/**
 * Only a CONTAINER at-rule nests other rules. Treating every `@` as a context
 * meant a declaration at-rule's contents produced no entry at all, so changing
 * or deleting a whole `@font-face` left the compared sequence identical.
 */
for (const [why, before, after] of [
  [
    "a changed @font-face",
    "@font-face{font-family:A;src:url(a.woff2)}",
    "@font-face{font-family:A;src:url(b.woff2)}",
  ],
  [
    "a deleted @font-face",
    "@font-face{font-family:A}.hero{color:red}",
    ".hero{color:red}",
  ],
  [
    "a changed @property",
    "@property --x{syntax:'<length>'}",
    "@property --x{syntax:'<color>'}",
  ],
] as const) {
  test(`${why} is a change`, () => {
    const report = renderedParity({
      before: new Map([["index.html", "<p>a</p>"]]),
      after: new Map([["index.html", "<p>a</p>"]]),
      stylesheets: { before: [before], after: [after] },
    });
    assert.equal(parityHolds(report), false, `${before} -> ${after}`);
  });
}

/**
 * The conversion adds exactly one rule -- the page-root wrapper is the first
 * user of `display:contents` on most sites. Every other addition changes what
 * renders, and accepting all of them let `.hero{color:red}` appear from
 * nowhere and pass.
 */
test("an addition that is not the wrapper rule fails", () => {
  const report = renderedParity({
    before: new Map([["index.html", "<p>a</p>"]]),
    after: new Map([["index.html", "<p>a</p>"]]),
    stylesheets: {
      before: [".a{color:red}"],
      after: [".a{color:red}.hero{color:red}"],
    },
  });
  assert.deepEqual(report.stylesheetRulesAdded, [".hero{color:red}"]);
  assert.equal(parityHolds(report), false);
});

/** A page the conversion produced and the baseline never had is a change. */
test("a page that appears only after conversion fails", () => {
  const report = renderedParity({
    before: new Map([["index.html", "<p>a</p>"]]),
    after: new Map([
      ["index.html", "<p>a</p>"],
      ["surprise.html", "<p>b</p>"],
    ]),
  });
  assert.deepEqual(report.appeared, ["surprise.html"]);
  assert.equal(parityHolds(report), false);
});
