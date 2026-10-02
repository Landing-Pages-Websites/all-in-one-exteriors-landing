import assert from "node:assert/strict";
import test from "node:test";

import { nameFromSourceIdentifier } from "../src/anchor-name.js";
import { renderAnchor } from "../src/anchors.js";
import { applyConfidenceGate } from "../src/gate.js";
import type { Finding, FindingCode } from "../src/report.js";
import { extractFiles } from "./support/proposals.js";

/**
 * What may NAME a field, for the anchor material that does not come from an
 * attribute.
 *
 * `#durableAttributeOf` asks the question for an `id` and an accessible name.
 * Two collectors did not pass through it: `#collectImage` told sibling images
 * apart by their `src`, which `image.upload` replaces, and `#collectLink` by
 * its `#fragment`, which `link.destination.edit` rewrites. `destinations.ts`
 * had already refused an external URL on exactly that ground, in the same
 * function, and kept the fragment.
 *
 * `AnchorName` now closes the class rather than these two instances: a name is
 * a branded type only `anchor-name.ts` mints, so a collector reaching an anchor
 * segment with a raw string does not compile. These cases pin the behaviour;
 * the type pins the shape.
 */

type Files = Readonly<Record<string, string>>;
const ENTRY = "Page.tsx";

interface Extraction {
  readonly anchors: readonly string[];
  readonly acceptedAnchors: readonly string[];
  readonly findings: readonly Finding[];
  readonly codes: readonly FindingCode[];
}

function extract(files: Files): Extraction {
  const { candidates, findings } = extractFiles(files, ENTRY);
  const gate = applyConfidenceGate(candidates);
  const all = [...findings, ...gate.findings];
  return {
    anchors: candidates.map((candidate) => renderAnchor(candidate.anchor)).sort(),
    acceptedAnchors: gate.accepted.map((candidate) => renderAnchor(candidate.anchor)).sort(),
    findings: all,
    codes: all.map((finding) => finding.code),
  };
}

function page(body: string, extra = ""): Files {
  return { [ENTRY]: `${extra}\nexport function Page() { return ${body}; }\n` };
}

/** Every `/`-delimited segment of every anchor, which is what a name becomes. */
function segmentsOf(extraction: Extraction): readonly string[] {
  return extraction.anchors.flatMap((anchor) => anchor.split("/"));
}

/**
 * The exact segments `renderAnchor` emits if `value` names a field, built by
 * asking `renderAnchor` rather than by writing the expected string out.
 *
 * Writing it out is what made three of these rows vacuous: a rendered name has
 * its `/` escaped to `~1`, so `at:/hero.png` and `at:https://example.com/x`
 * were compared against strings the renderer cannot produce, and those rows
 * passed whether or not an image source named its field. Going through the
 * production renderer means the comparison cannot drift from it again — an
 * escaping change breaks nothing here, and a name reaching an anchor is caught
 * whatever characters it holds.
 */
function segmentsIfItNamedAField(value: string): readonly string[] {
  const named = nameFromSourceIdentifier(value);
  return [
    renderAnchor([{ kind: "discriminator", value: named }]),
    renderAnchor([{ kind: "region", name: named }]),
  ];
}

/**
 * Values this tool offers the customer. None may appear as any anchor segment.
 * Every row must produce at least one anchor, or it proves nothing — one row
 * here passed in BOTH directions until that assertion was added, because its
 * fixture produced no candidates at all.
 */
const WITHIN_REACH: readonly (readonly [string, Files, string])[] = [
  [
    "an image source, which `image.upload` replaces",
    page(`<section id="s"><h2>H</h2><img src="/hero.png" alt="Hero" /></section>`),
    "/hero.png",
  ],
  [
    "an image source on the next/image default import",
    page(
      `<section id="s"><h2>H</h2><Img src="/hero.png" alt="Hero" /></section>`,
      `import Img from "next/image";`,
    ),
    "/hero.png",
  ],
  [
    "an image alt, which `image.alt.edit` rewrites",
    page(`<section id="s"><h2>H</h2><img src="/hero.png" alt="Hero" /></section>`),
    "Hero",
  ],
  [
    "a link fragment, which `link.destination.edit` rewrites",
    page(`<section id="s"><a href="#pricing">Pricing</a></section>`),
    "#pricing",
  ],
  [
    "a link fragment on the next/link default import",
    page(
      `<section id="s"><Anchor href="#pricing">Pricing</Anchor></section>`,
      `import Anchor from "next/link";`,
    ),
    "#pricing",
  ],
  [
    "an external destination",
    page(`<section id="s"><a href="https://example.com/x">Out</a></section>`),
    "https://example.com/x",
  ],
  [
    "a mailto destination",
    page(`<section id="s"><a href="mailto:hi@example.com">Mail</a></section>`),
    "hi@example.com",
  ],
  [
    "a tel destination",
    page(`<section id="s"><a href="tel:+15551234567">Call</a></section>`),
    "+15551234567",
  ],
];

test("no value this tool proposes as editable ever names a field", () => {
  for (const [name, files, value] of WITHIN_REACH) {
    const extraction = extract(files);
    assert.ok(extraction.anchors.length > 0, `${name}: produced no anchors, so it proves nothing`);
    const forbidden = segmentsIfItNamedAField(value);
    for (const segment of segmentsOf(extraction)) {
      assert.ok(
        !forbidden.includes(segment),
        `${name}: '${value}' names a field — ${JSON.stringify(extraction.anchors)}`,
      );
    }
  }
});

/**
 * The negative control. Refusing everything satisfies the rule above and
 * destroys the tool, so each of these must survive. Compared as whole
 * segments, because `at:#` is a prefix of `at:#pricing` and a substring test
 * would let the fragment back in.
 */
const BEYOND_REACH: readonly (readonly [string, Files, string])[] = [
  [
    "a literal `id` on a host leaf",
    page(`<section id="s"><h2>H</h2><img id="hero" src="/a.png" alt="A" /></section>`),
    "hero",
  ],
  [
    "a self-referential destination, which the customer is granted nothing over",
    page(`<section id="s"><a href="#">Brand</a></section>`),
    "#",
  ],
  [
    "a route on this same site, which folds into the same self destination",
    page(`<section id="s"><a href="/about">About</a></section>`),
    "#",
  ],
  [
    "a module constant's NAME, which no edit to its value changes",
    page(
      `<section id="s"><a href={BOOK_URL}>Book</a></section>`,
      `const BOOK_URL = "https://book.example.com";`,
    ),
    "const:BOOK_URL",
  ],
  [
    // `next/image` and `next/script` live in node_modules, so their `id` prop
    // is unreadable by construction. `#nameVerdictOf` calls an unresolvable
    // receiver durable for exactly this reason: refusing it would leave the
    // remedy below — write an `id` — one the tool then declines.
    "a literal `id` on a component this repository cannot read",
    page(
      `<section id="s"><h2>H</h2><Img id="hero" src="/a.png" alt="A" /></section>`,
      `import Img from "next/image";`,
    ),
    "hero",
  ],
];

test("a value beyond the customer's reach still names a field", () => {
  for (const [name, files, value] of BEYOND_REACH) {
    const extraction = extract(files);
    assert.ok(extraction.anchors.length > 0, `${name}: produced no anchors, so it proves nothing`);
    const expected = segmentsIfItNamedAField(value);
    assert.ok(
      segmentsOf(extraction).some((segment) => expected.includes(segment)),
      `${name}: no anchor carries '${value}' — ${JSON.stringify(extraction.anchors)}`,
    );
  }
});

/**
 * A refusal is never silent. A shallower anchor reads exactly like an ordinary
 * one, so an operator would be left with siblings that collide for no visible
 * reason, and a lone element named only by being alone.
 */
const LOUD_CASES: readonly (readonly [string, Files, readonly FindingCode[]])[] = [
  [
    "one image with no `id` is still proposed, and still says so",
    page(`<section id="s"><h2>H</h2><img src="/hero.png" alt="Hero" /></section>`),
    ["NO_DURABLE_ANCHOR"],
  ],
  [
    "two images differing only by source collide, and say why",
    page(`<section id="s"><img src="/a.png" alt="A" /><img src="/b.png" alt="B" /></section>`),
    ["NO_DURABLE_ANCHOR", "NO_DURABLE_ANCHOR", "AMBIGUOUS_ANCHOR", "AMBIGUOUS_ANCHOR"],
  ],
  [
    "two links differing only by fragment collide, and say why",
    page(`<section id="s"><a href="#one">One</a><a href="#two">Two</a></section>`),
    ["NO_DURABLE_ANCHOR", "NO_DURABLE_ANCHOR", "AMBIGUOUS_ANCHOR", "AMBIGUOUS_ANCHOR"],
  ],
];

test("a declined name is reported where it was declined", () => {
  for (const [name, files, expected] of LOUD_CASES) {
    // The whole multiset, so a finding the author did not expect fails the row
    // instead of being skipped.
    assert.deepEqual([...extract(files).codes].sort(), [...expected].sort(), name);
  }
});

test("the finding names the value it declined and the remedy", () => {
  for (const [label, files, needle] of [
    ["image", page(`<section id="s"><h2>H</h2><img src="/hero.png" alt="Hero" /></section>`), /\/hero\.png/u],
    ["link", page(`<section id="s"><a href="#pricing">Pricing</a></section>`), /#pricing/u],
  ] as const) {
    const declined = extract(files).findings.find(
      (finding) => finding.code === "NO_DURABLE_ANCHOR",
    );
    assert.ok(declined !== undefined, `${label}: no NO_DURABLE_ANCHOR finding`);
    assert.match(declined.decision, needle, `${label}: does not name the declined value`);
    assert.match(declined.decision, /`id`/u, `${label}: does not name the remedy`);
  }
});

/**
 * The remedy the finding names has to work, or it is not a remedy — on a plain
 * `<img>` and on `next/image`, which is where most image fields in these
 * repositories live.
 */
test("giving each sibling a literal `id` restores both", () => {
  for (const [label, tag, extra] of [
    ["host img", "img", ""],
    ["next/image", "Img", `import Img from "next/image";`],
  ] as const) {
    const collided = extract(
      page(
        `<section id="s"><${tag} src="/a.png" alt="A" /><${tag} src="/b.png" alt="B" /></section>`,
        extra,
      ),
    );
    assert.deepEqual(collided.acceptedAnchors, [], `${label}: both images are withheld`);

    const named = extract(
      page(
        `<section id="s"><${tag} id="left" src="/a.png" alt="A" /><${tag} id="right" src="/b.png" alt="B" /></section>`,
        extra,
      ),
    );
    assert.deepEqual(named.acceptedAnchors, [
      `component:Page/region:s/role:${tag}/at:left`,
      `component:Page/region:s/role:${tag}/at:right`,
    ], label);
    assert.deepEqual(named.codes, [], `${label}: nothing left to report`);
  }
});
