import assert from "node:assert/strict";
import test from "node:test";

import type { Proposal } from "../src/propose.js";
import type { Finding } from "../src/report.js";
import { configFor, findingsOf, run, workspace } from "./support/proposals.js";

/**
 * The claim under test: the contract describes no route this repository does
 * not serve. See the package README, "What the operator must supply", for the
 * three readings and which of them excludes a route.
 *
 * All Points Media is the case that produced it: a `notFound()`-only page
 * declared `purpose: "service"`, `sitemap.included: true`, emitted as an
 * indexable service page with a canonical URL for a route that 404s.
 */

const ROUTES = [
  "/",
  "/sparse",
  "/hidden",
  "/reexported",
  "/indirect",
  "/aliased",
  "/namespaced",
  "/arrow",
  "/awaited",
  "/gatedsection",
  "/internal",
  "/gated",
  "/maybe",
  "/decoy",
  "/shadowed",
  "/mute",
  "/embeds",
  "/jsxhidden",
  "/anonymous",
  "/anonarrow",
  "/anonjsx",
  "/anongated",
  "/embedsjsx",
] as const;

/**
 * Every route declared, indexable on exactly the ones named.
 *
 * The trigger is varied rather than the fixture, because two of the three
 * readings only apply to a route the config puts in the sitemap, and the
 * strongest one applies whatever the config says.
 */
function proposalWithIndexable(
  indexable: readonly string[],
  unmanaged: readonly string[] = [],
): Proposal {
  return run(
    workspace(
      "hiddenroute",
      configFor(ROUTES, (route) => ({
        purpose: "service",
        sitemap: {
          included: indexable.includes(route),
          changeFrequency: "monthly",
          priority: 0.5,
        },
        managedContent: !unmanaged.includes(route),
      })),
    ),
  );
}

function notServed(proposal: Proposal): readonly Finding[] {
  return findingsOf(proposal, "ROUTE_NOT_SERVED");
}

function routesIn(proposal: Proposal): readonly string[] {
  return (proposal.contract?.pages ?? []).map((page) =>
    page.route.kind === "static" ? page.route.path : page.route.pattern,
  );
}

/**
 * Every shape that PROVES the route never returns markup, not just the one the
 * customer site happened to use. Each reaches the proof through a different
 * part of the resolver: a re-export, a default-exported import, an import
 * alias, a namespace, a concise arrow body, a body that works before it 404s,
 * and a layout that takes the route below it with it.
 *
 * The last four are the review's: a component that writes JSX below the call
 * resolves as a declaration by every structural test, and an anonymous default
 * export binds no name for a by-name lookup to find. Both were reachable gaps,
 * and both are routes a real Next site is written with.
 */
const PROVEN_404: readonly {
  readonly route: string;
  readonly file: string;
  /** How that module spells the call, which is what the finding quotes. */
  readonly call: string;
}[] = [
  { route: "/hidden", file: "app/hidden/page.tsx", call: "notFound()" },
  { route: "/reexported", file: "components/HiddenBody.tsx", call: "notFound()" },
  { route: "/indirect", file: "components/HiddenBody.tsx", call: "notFound()" },
  { route: "/aliased", file: "app/aliased/page.tsx", call: "gone()" },
  {
    route: "/namespaced",
    file: "app/namespaced/page.tsx",
    call: "navigation.notFound()",
  },
  { route: "/arrow", file: "app/arrow/page.tsx", call: "notFound()" },
  { route: "/awaited", file: "app/awaited/page.tsx", call: "notFound()" },
  { route: "/internal", file: "app/internal/page.tsx", call: "notFound()" },
  {
    route: "/gatedsection",
    file: "app/gatedsection/layout.tsx",
    call: "notFound()",
  },
  { route: "/jsxhidden", file: "app/jsxhidden/page.tsx", call: "notFound()" },
  { route: "/anonymous", file: "app/anonymous/page.tsx", call: "notFound()" },
  { route: "/anonarrow", file: "app/anonarrow/page.tsx", call: "notFound()" },
  { route: "/anonjsx", file: "app/anonjsx/page.tsx", call: "notFound()" },
];

for (const { route, file, call } of PROVEN_404) {
  test(`a route that always 404s is excluded and named: ${route}`, () => {
    const proposal = proposalWithIndexable([route]);

    assert.equal(
      routesIn(proposal).includes(route),
      false,
      "the contract carries no page for it, so no canonical and no robots either",
    );
    const findings = notServed(proposal).filter(
      (finding) => finding.anchor === `route:${route}`,
    );
    assert.equal(findings.length, 1, "one finding, not one per signal");
    const [finding] = findings;
    assert.match(
      finding?.evidence ?? "",
      /sitemap\.included: true and purpose 'service'/u,
      "it quotes the declaration, so nobody opens the config to see it",
    );
    assert.match(
      finding?.evidence ?? "",
      /notFound\(\)/u,
      "it names the framework call whatever the module calls it",
    );
    assert.equal(
      finding?.evidence.includes(`\`${call}\``),
      true,
      "and quotes the source as written",
    );
    assert.equal(
      finding?.location?.file.endsWith(file),
      true,
      `it points at ${file}, where the 404 is written`,
    );
  });
}

/**
 * The declaration is context, never the trigger. The whole page descriptor is
 * the advertisement — canonical, robots, title, intent — so a route kept out of
 * the sitemap and left in the contract is the same defect one field over. All
 * Points Media's hand fix set `sitemap.included: false`, and the shipped
 * contract still claims `index: true` and a canonical URL for a route that 404s.
 */
test("a 404 route is excluded whether or not the config advertises it", () => {
  const proposal = proposalWithIndexable([]);

  const excluded = PROVEN_404.map(({ route }) => route);
  assert.deepEqual(
    routesIn(proposal).filter((route) => excluded.includes(route)),
    [],
  );
  assert.deepEqual(
    notServed(proposal)
      .map((finding) => finding.anchor)
      .sort(),
    excluded.map((route) => `route:${route}`).sort(),
    "each named once, and nothing else reported when nothing is indexable",
  );
});

/**
 * `managedContent: false` says a customer owns none of this route's words. It
 * says nothing about whether the route answers, and the contract page is still
 * a claim the contract makes.
 */
test("an internal screen that 404s is excluded too", () => {
  const proposal = proposalWithIndexable(["/internal"], ["/internal"]);

  assert.equal(routesIn(proposal).includes("/internal"), false);
});

/** The excluded route's declaration is inert, and says so exactly once. */
test("a declaration for an excluded route is not also reported as a typo", () => {
  const proposal = proposalWithIndexable(["/hidden"]);
  const undeclared = findingsOf(proposal, "SEO_INPUT_REQUIRED").filter((finding) =>
    finding.decision.includes("serves no such route"),
  );

  assert.deepEqual(undeclared, []);
});

test("a sparse but real page is kept", () => {
  const proposal = proposalWithIndexable(["/sparse"]);

  assert.equal(routesIn(proposal).includes("/sparse"), true);
  assert.equal(
    notServed(proposal).some((finding) => finding.anchor === "route:/sparse"),
    false,
    "one heading is thin, not unserved",
  );
});

/**
 * Anonymous and gated. Reading the body directly must not cost the branch
 * rule: the export writes markup on the other path, so nothing is proven and
 * the route is kept, exactly as the named `/gated` beside it.
 *
 * It is still reported, because an anonymous default export is a thing this
 * walk has always declined to read. That is the weak reading, and the point
 * here is which one it is: "could not be read", never "answers 404".
 */
test("an anonymous export that renders on one branch is kept", () => {
  const proposal = proposalWithIndexable(["/anongated"]);

  assert.equal(routesIn(proposal).includes("/anongated"), true);
  const [finding] = notServed(proposal).filter(
    (entry) => entry.anchor === "route:/anongated",
  );
  assert.equal(finding?.evidence.includes("answers 404"), false);
  assert.match(finding?.evidence ?? "", /could be read/u);
});

/**
 * The same proof, asked of a rendered tag rather than a route.
 *
 * Markup below a component that always 404s is markup no visitor sees, so the
 * walk stops there and proposes nothing from it, which is the rule the render
 * walk exists to enforce. The page around it still serves.
 */
test("a JSX-bearing 404 component is not walked for its words", () => {
  const proposal = proposalWithIndexable(["/embedsjsx"]);

  assert.equal(routesIn(proposal).includes("/embedsjsx"), true);
  const values = proposal.fields.map((field) => field.name);
  assert.equal(
    JSON.stringify(proposal.sourceDocuments.get("src/content/pages/embedsjsx.json")).includes(
      "Markup below a 404",
    ),
    false,
    "the unreachable heading is not offered to the customer",
  );
  assert.equal(values.length > 0, true, "and the page's own heading still is");
  const named = findingsOf(proposal, "UNRESOLVED_RENDER_TARGET").filter((finding) =>
    finding.evidence.includes("<JsxHiddenBody />"),
  );
  assert.equal(named.length, 1, "the tag is named where it is written");
});

/**
 * The 404 is on a branch and the other branch returns markup, so the route
 * serves a page. A rule that keyed on `notFound()` appearing anywhere in the
 * body would exclude this one, and every gated page on a real site with it.
 */
test("a page that 404s on one branch and renders on the other is kept", () => {
  const proposal = proposalWithIndexable(["/gated"]);

  assert.equal(routesIn(proposal).includes("/gated"), true);
  assert.equal(
    notServed(proposal).some((finding) => finding.anchor === "route:/gated"),
    false,
  );
});

/**
 * Nothing here is proven: the body returns the result of a call this reader
 * cannot follow, so the route may well serve a page. It is reported, and the
 * route is kept, because excluding on a reading this weak would drop pages that
 * are perfectly fine.
 */
test("a route whose module could not be read is reported, not excluded", () => {
  const proposal = proposalWithIndexable(["/maybe"]);

  assert.equal(routesIn(proposal).includes("/maybe"), true);
  assert.equal(
    notServed(proposal).some((finding) => finding.anchor === "route:/maybe"),
    true,
    "but named, beside the declaration that advertises it",
  );
});

/**
 * `notFound` is Next's only when Next supplies it. A local function that merely
 * spells the name proves nothing, so this route is reported like any other
 * unreadable one rather than excluded as a 404.
 */
test("a local function spelled notFound is not Next's 404", () => {
  const proposal = proposalWithIndexable(["/decoy"]);

  assert.equal(routesIn(proposal).includes("/decoy"), true);
  assert.equal(
    notServed(proposal).some((finding) => finding.anchor === "route:/decoy"),
    true,
  );
});

/**
 * The import is in scope and the spelling matches, and it is still not the
 * framework's call: a nearer binding is what the language reads. Taking the
 * spelling alone would exclude this route on the strength of a local function.
 */
test("a call shadowed by a local of the same name proves nothing", () => {
  const proposal = proposalWithIndexable(["/shadowed"]);

  assert.equal(routesIn(proposal).includes("/shadowed"), true);
  assert.equal(
    notServed(proposal).some((finding) => finding.anchor === "route:/shadowed"),
    true,
    "reported as unread, like any other module this reader could not follow",
  );
});

/**
 * The weakest reading, and the reason it only ever reports: a page really can
 * be all pictures, or have every value refused by the confidence gate. Naming
 * it beside the declaration is the whole value.
 */
test("a route that renders and carries nothing is reported, not excluded", () => {
  const proposal = proposalWithIndexable(["/mute"]);

  assert.equal(routesIn(proposal).includes("/mute"), true);
  assert.equal(
    notServed(proposal).some((finding) => finding.anchor === "route:/mute"),
    true,
  );
});

test("a route that renders and carries something is not reported at all", () => {
  const proposal = proposalWithIndexable(["/"]);

  assert.equal(
    notServed(proposal).some((finding) => finding.anchor === "route:/"),
    false,
  );
});

/** A route owning no content carries nothing by design, so nothing is said. */
test("an internal screen that carries nothing is not reported", () => {
  const proposal = proposalWithIndexable(["/mute"], ["/mute"]);

  assert.equal(
    notServed(proposal).some((finding) => finding.anchor === "route:/mute"),
    false,
  );
});

/**
 * A route may render perfectly well and still name a 404 inside itself. The
 * route is served, so it is kept; what the tag stands in for was never read, so
 * the walk names the tag and says why in its own words.
 */
test("a tag that names a 404 is reported where it is written", () => {
  const proposal = proposalWithIndexable(["/embeds"]);

  assert.equal(routesIn(proposal).includes("/embeds"), true);
  const named = findingsOf(proposal, "UNRESOLVED_RENDER_TARGET").filter((finding) =>
    finding.evidence.includes("<HiddenBody />"),
  );
  assert.equal(named.length, 1);
  assert.match(named[0]?.decision ?? "", /always calls `notFound\(\)`/u);
  assert.equal(
    named[0]?.location?.file.endsWith("app/embeds/page.tsx"),
    true,
    "located at the tag, not at the module it names",
  );
});
