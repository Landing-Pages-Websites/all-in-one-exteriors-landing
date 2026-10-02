import assert from "node:assert/strict";
import test from "node:test";

import { isJsonObject } from "../src/json-write.js";
import type { Proposal } from "../src/propose.js";
import { findingsOf, run, seoOf, workspace } from "./support/proposals.js";

/**
 * Internal SEO is per route. A route resolves its own module first and then the
 * layouts that wrap it — genuine Next.js inheritance — and nothing a sibling
 * route declares may ever reach it.
 */

const CONFIG = {
  contentRoot: "src/content",
  assetRoot: "public",
  businessIdentity: {
    legalName: "Fixture Ltd",
    displayName: "Fixture",
    telephone: "+15555550100",
    email: "hello@example.com",
    description: "A fixture business.",
    sameAs: [],
  },
};

function routes(): Proposal {
  return run(workspace("routes", CONFIG));
}

interface ResolutionCase {
  readonly slug: string;
  readonly why: string;
  readonly title: string | null;
  readonly description: string | null;
  /** `null` where the route declared robots this reader cannot read, so none is emitted. */
  readonly index: boolean | null;
  /** Asserted only where `follow` is what separates one write order from another. */
  readonly follow?: boolean;
}

/**
 * The `routes` fixture declares a different metadata shape on every route. Each
 * case names the ONE resolution rule it pins down.
 */
const RESOLUTION_CASES: readonly ResolutionCase[] = [
  {
    slug: "home",
    why: "a route that declares both keeps both",
    title: "Home title",
    description: "Home description.",
    index: true,
  },
  {
    slug: "about",
    why: "a field the route omits comes from its layout, not from a sibling",
    title: "About title",
    description: "Layout description.",
    index: true,
  },
  {
    slug: "pricing",
    why: "robots declared on the route override the layout's for that route only",
    title: "Pricing title",
    description: "Pricing description.",
    index: false,
  },
  {
    slug: "blog",
    why: "the nearest layout supplies the title, the root layout the description",
    title: "Blog title",
    description: "Layout description.",
    index: true,
  },
  {
    slug: "mutateassign",
    why: "a helper result Object.assign writes to afterwards is not what Next serves",
    title: null,
    description: null,
    index: null,
  },
  {
    slug: "mutatedirect",
    why: "a top-level assignment to one key is the value Next serves, over the initializer's",
    title: "Mutatedirect title",
    description: "Layout description.",
    index: false,
    follow: false,
  },
  {
    slug: "helperassign",
    why: "the same assignment over a helper result, which is how a real site hides one route",
    title: "Helperassign title",
    description: "Helperassign description.",
    index: false,
    follow: false,
  },
  {
    slug: "assigntitle",
    why: "a literal is a plain data value, so a title assignment is read the same way",
    title: "Assigntitle title",
    description: "Assigntitle description.",
    index: true,
  },
  {
    slug: "writetwice",
    why: "two assignments to one key: the LAST is the value, and it beats the initializer",
    title: "Writetwice title",
    description: "Writetwice description.",
    index: true,
    follow: false,
  },
  {
    slug: "readafterwrite",
    why: "a READ hands the object somewhere this reader cannot follow, so it refuses",
    title: null,
    description: null,
    index: null,
  },
  {
    slug: "assigncall",
    why: "a call decides the assigned value, so the value is not written at the assignment",
    title: null,
    description: null,
    index: null,
  },
  {
    slug: "assignspread",
    why: "a spread in the assigned object may supply or overwrite any key",
    title: null,
    description: null,
    index: null,
  },
  {
    slug: "assignnested",
    why: "a nested path writes INTO a value read from elsewhere, which is not one value",
    title: null,
    description: null,
    index: null,
  },
  {
    slug: "assignbefore",
    why: "a write above the declaration never runs, because the module throws",
    title: null,
    description: null,
    index: null,
  },
  {
    slug: "protoassign",
    why: "`__proto__` as a target replaces the PROTOTYPE, so what it writes is inherited",
    title: null,
    description: null,
    index: null,
  },
  {
    slug: "protoassignvalue",
    why: "`__proto__` inside the assigned value is the same hazard as `__proto__` as its target",
    title: null,
    description: null,
    index: null,
  },
  {
    slug: "protoassignnull",
    why: "the same target with a plain data value, so only the key can refuse it",
    title: null,
    description: null,
    index: null,
  },
  {
    slug: "assignelement",
    why: "an element access names its key with an expression this reader does not evaluate",
    title: null,
    description: null,
    index: null,
  },
  {
    slug: "protoassignelement",
    // An outcome row: the element access refuses before the key is ever read,
    // so both guards catch this and neither is isolated by it.
    why: "the same `__proto__` write spelled as an element access",
    title: null,
    description: null,
    index: null,
  },
  {
    slug: "assignoutside",
    why: "an outer key sharing a nested one's name is not a write to the nested object",
    title: "Assignoutside title",
    description: "Assignoutside description.",
    index: false,
    follow: false,
  },
  {
    slug: "assigncompound",
    why: "a compound assignment reads the existing value to decide what it writes",
    title: null,
    description: null,
    index: null,
  },
  {
    slug: "assignbranch",
    why: "a write inside a branch may not run, so the served value is a condition away",
    title: null,
    description: null,
    index: null,
  },
  {
    slug: "suppliedrobots",
    why: "a nested object the CALL supplied is the route's too, for the same reason",
    title: null,
    description: "Supplied-robots description.",
    index: null,
  },
  {
    slug: "assignsubstituted",
    why: "an assigned object is the ROUTE's, so a helper parameter of the same name may not answer",
    title: null,
    description: "Assigned-robots description.",
    index: null,
  },
  {
    slug: "evalassign",
    why: "eval runs source no AST walk reads, whatever else the module writes plainly",
    title: null,
    description: null,
    index: null,
  },
  {
    slug: "mutatealias",
    why: "a write reached through an alias, which no list of write forms catches",
    title: null,
    description: null,
    index: null,
  },
  {
    slug: "mutateeval",
    why: "a write through eval holds no reference the AST walk could find",
    title: null,
    description: null,
    index: null,
  },
  {
    slug: "reachable",
    why: "another module imports this page's live metadata binding and writes through it",
    title: null,
    description: null,
    index: null,
  },
  {
    slug: "barreled",
    why: "a barrel stands between the page and the module that writes through it",
    title: null,
    description: null,
    index: null,
  },
  {
    slug: "required",
    why: "a CommonJS require reaches the module and names no binding",
    title: null,
    description: null,
    index: null,
  },
  {
    slug: "starnamed",
    why: "`export * as metadata from` publishes a module namespace under that name",
    title: null,
    description: null,
    index: null,
  },
  {
    slug: "starred",
    why: "`export *` can supply metadata, so the route is declared rather than absent",
    title: null,
    description: null,
    index: null,
  },
  {
    slug: "dynamic",
    why: "a dynamic import reaches the module and the import scan cannot see it",
    title: null,
    description: null,
    index: null,
  },
  {
    slug: "namespaced",
    why: "a namespace import reaches the binding without ever naming it",
    title: null,
    description: null,
    index: null,
  },
  {
    slug: "destructured2",
    why: "`export const { metadata } = ...` declares metadata with no initializer to read",
    title: null,
    description: null,
    index: null,
  },
  {
    slug: "reexported",
    why: "`export { x as metadata } from` publishes someone else's object, so neither the local beside it nor the layout may answer",
    title: null,
    description: null,
    index: null,
  },
  {
    slug: "exportclause",
    why: "`export { x as metadata }` is a declaration, so it never falls back to a layout",
    title: "Exportclause title",
    description: "Layout description.",
    index: false,
  },
  {
    slug: "contact",
    why: "a route declaring no metadata resolves only what a layout declares",
    title: null,
    description: "Layout description.",
    index: true,
  },
  {
    slug: "helper",
    why: "metadata built by a helper resolves from the values the CALL supplies",
    title: "Helper title",
    description: "Helper description.",
    index: true,
  },
  {
    slug: "spread",
    why: "a value the helper itself decides resolves from the helper",
    title: "Spread title",
    description: "Decided inside the helper.",
    index: true,
  },
  {
    slug: "renamed",
    why: "a renamed destructure maps the local name back to the key the call wrote",
    title: null,
    description: "Renamed description.",
    index: true,
  },
  {
    slug: "branching",
    why: "a helper with two returns is not read, and does not inherit a layout's",
    title: null,
    description: null,
    index: null,
  },
  {
    slug: "nested",
    why: "a value the helper computes is unreadable, and does not inherit a layout's",
    title: null,
    description: null,
    index: true,
  },
  {
    slug: "shadowed",
    why: "a local shadowing a parameter is not read, whatever the call supplied",
    title: null,
    description: null,
    index: null,
  },
  {
    slug: "rest",
    why: "a rest element gathers keys this reader never enumerated",
    title: null,
    description: null,
    index: null,
  },
  {
    slug: "twoargs",
    why: "two parameters make it unclear which argument feeds the pattern",
    title: null,
    description: null,
    index: null,
  },
  {
    slug: "spreadarg",
    why: "a spread in the argument may supply the key from anywhere",
    title: null,
    description: null,
    index: null,
  },
  {
    slug: "reassigned",
    why: "a helper that reassigns a substituted parameter is not read",
    title: null,
    description: null,
    index: null,
  },
  {
    slug: "returnspread",
    why: "a spread in the returned object may overwrite the key",
    title: null,
    description: null,
    index: null,
  },
  {
    slug: "identifier",
    why: "a direct identifier initializer resolves, and does not inherit",
    title: null,
    description: "Identifier description.",
    index: true,
  },
  {
    slug: "destructured",
    why: "a destructuring assignment writes a substituted binding too",
    title: null,
    description: null,
    index: null,
  },
  {
    slug: "mutated",
    why: "a write THROUGH a substituted binding changes what the call supplied",
    title: null,
    description: null,
    index: null,
  },
  {
    slug: "blockvar",
    why: "a `var` in a nested block shadows the parameter just as a top-level one does",
    title: null,
    description: null,
    index: null,
  },
  {
    slug: "computed",
    why: "a computed key after the plain one overwrites it at runtime",
    title: null,
    description: null,
    index: null,
  },
  {
    slug: "robotsname",
    why: "a robots flag written as a name leaves the description readable",
    title: null,
    description: "Robots description.",
    index: null,
  },
  {
    slug: "defaulted",
    why: "a parameter default resolves in the HELPER's module, where it is written",
    title: null,
    description: "Fallback from the helper module.",
    index: true,
  },
  {
    slug: "closure",
    why: "a closure writing a parameter is caught past the function boundary",
    title: null,
    description: null,
    index: null,
  },
  {
    slug: "assign",
    why: "a call mutating a substituted object makes THAT field unreadable, not the helper",
    title: null,
    description: "Assign description.",
    index: null,
  },
  {
    slug: "accessor",
    why: "an accessor is not a data member, and does not read as absent",
    title: null,
    description: null,
    index: null,
  },
  {
    slug: "noarchive",
    why: "an unmodelled robots directive makes the block unreadable",
    title: null,
    description: "Noarchive description.",
    index: null,
  },
  {
    slug: "localcall",
    why: "a call over a local, mentioning no substituted name, is still read",
    title: null,
    description: "Local-call description.",
    index: true,
  },
  {
    slug: "aliased",
    why: "an aliased export resolves the binding that RUNS, not a same-named private one",
    title: null,
    description: "Aliased description.",
    index: true,
  },
  {
    slug: "propertyname",
    why: "a substituted name as a property NAME is not a reference to the binding",
    title: null,
    description: "Property-name description.",
    index: true,
  },
  {
    slug: "aliasassign",
    why: "an ALIAS reaching a substituted object makes that field unreadable",
    title: null,
    description: "Alias-assign description.",
    index: null,
  },
  {
    slug: "robotsaccessor",
    why: "an accessor one level down refuses the helper, since a getter runs code",
    title: null,
    description: null,
    index: null,
  },
  {
    slug: "duplicate",
    why: "duplicate keys mean the LAST wins, so the first must not be read",
    title: null,
    description: null,
    index: null,
  },
  {
    slug: "memberalias",
    // An outcome row. `robots.inner` needs an unmodelled `inner` key on the
    // robots object to exist at all, and an unmodelled key already makes the
    // block unreadable -- so the member-chain alias rule cannot be isolated
    // here and is kept as depth.
    why: "a MEMBER of a substituted object is part of the same object",
    title: null,
    description: "Member-alias description.",
    index: null,
  },
  {
    slug: "nestedaccessor",
    // An outcome row, not a proof of the recursive member check: the getter's
    // own `return` is counted as a second return by `countReturns`, which
    // refuses first. Both guards catch it and neither is isolated by this
    // fixture.
    why: "an accessor in a nested object that is not robots",
    title: null,
    description: null,
    index: null,
  },
  {
    slug: "container",
    why: "a CONTAINER holding the substituted object is a use outside the return",
    title: null,
    description: "Container description.",
    index: null,
  },
  {
    slug: "looptarget",
    why: "a for...of target writes without being an assignment expression",
    title: null,
    description: "Loop description.",
    index: null,
  },
  {
    slug: "argumentsobj",
    why: "`arguments` reaches what the call supplied under a name no parameter names",
    title: null,
    description: null,
    index: null,
  },
  {
    slug: "sideeffect",
    why: "a side-effecting expression in the returned object runs BEFORE the return",
    title: null,
    description: null,
    index: null,
  },
  {
    slug: "nestedvalues",
    why: "the same value in nested objects is a plain value and is still read",
    title: "Nested title",
    description: "Nested-values description.",
    index: true,
  },
  {
    slug: "arraynested",
    why: "a value held inside an array is not a modelled position, so that field fails closed",
    title: null,
    description: "Array-nested description.",
    index: true,
  },
  {
    slug: "directspread",
    why: "a direct object gets the same plain-data validation the helper return does",
    title: null,
    description: null,
    index: null,
  },
  {
    slug: "inherited",
    why: "`__proto__` in a call argument changes what destructuring reads",
    title: null,
    description: null,
    index: null,
  },
  {
    slug: "protorobots",
    why: "`__proto__` in a nested robots object makes the whole helper unreadable",
    title: null,
    description: null,
    index: null,
  },
  {
    slug: "protodirect",
    why: "the same shape in a direct object is validated by the same reader",
    title: null,
    description: null,
    index: null,
  },
  {
    slug: "evalhelper",
    why: "direct eval runs source no AST scan reads, so the helper proves nothing",
    title: null,
    description: null,
    index: null,
  },
  {
    slug: "legal",
    why: "a declared title the tool cannot read does not inherit its layout's",
    title: null,
    description: "Legal description.",
    index: true,
  },
];

test("every route resolves the metadata of its own chain", () => {
  const proposal = routes();
  for (const expected of RESOLUTION_CASES) {
    const seo = seoOf(proposal, expected.slug);
    assert.deepEqual(seo["title"] ?? null, expected.title, `title: ${expected.why}`);
    assert.deepEqual(
      seo["description"] ?? null,
      expected.description,
      `description: ${expected.why}`,
    );
    const indexing = seo["indexing"];
    if (expected.index === null) {
      // A declared-but-unreadable robots block emits nothing rather than a
      // default this reader invented.
      assert.equal(indexing, undefined, `indexing: ${expected.why}`);
    } else {
      assert.ok(isJsonObject(indexing), `indexing missing for ${expected.slug}`);
      assert.equal(indexing["index"], expected.index, `indexing: ${expected.why}`);
      if (expected.follow !== undefined) {
        assert.equal(indexing["follow"], expected.follow, `follow: ${expected.why}`);
      }
    }
  }
});

test("no route is given metadata that only a sibling route declares", () => {
  const proposal = routes();
  const declaredBySiblings = new Set(
    RESOLUTION_CASES.flatMap((entry) => [entry.title, entry.description]).filter(
      (value): value is string => value !== null,
    ),
  );
  for (const expected of RESOLUTION_CASES) {
    const seo = seoOf(proposal, expected.slug);
    const own = new Set([expected.title, expected.description]);
    for (const key of ["title", "description"]) {
      const value = seo[key];
      if (typeof value !== "string") continue;
      assert.ok(
        own.has(value) || !declaredBySiblings.has(value),
        `${expected.slug} resolved '${value}', which belongs to another route`,
      );
    }
  }
});

test("a route that resolves nothing is refused against that route, not another", () => {
  const anchors = findingsOf(routes(), "SEO_INPUT_REQUIRED").map((finding) => finding.anchor);
  assert.ok(anchors.includes("seo:/contact:seo.title"));
  assert.ok(anchors.includes("seo:/legal:seo.title"));
  // Inheritance from a layout is a resolution, never a refusal.
  assert.ok(!anchors.includes("seo:/about:seo.title"));
  // A DECLARED value the tool cannot read is refused against its own route and
  // does not fall back to a layout -- the same rule `/legal` pins for a title.
  // `/nested` declares a description its helper computes, so it is refused
  // here; every other route resolves one.
  // Every route that DECLARES metadata this reader cannot read is refused
  // against itself. A route that declares none inherits, and is absent here.
  assert.deepEqual(
    anchors.filter((anchor) => anchor?.endsWith(":seo.description")).sort(),
    [
      "seo:/accessor:seo.description",
      "seo:/argumentsobj:seo.description",
      "seo:/assignbefore:seo.description",
      "seo:/assignbranch:seo.description",
      "seo:/assigncall:seo.description",
      "seo:/assigncompound:seo.description",
      "seo:/assignelement:seo.description",
      "seo:/assignnested:seo.description",
      "seo:/assignspread:seo.description",
      "seo:/barreled:seo.description",
      "seo:/blockvar:seo.description",
      "seo:/branching:seo.description",
      "seo:/closure:seo.description",
      "seo:/computed:seo.description",
      "seo:/destructured2:seo.description",
      "seo:/destructured:seo.description",
      "seo:/directspread:seo.description",
      "seo:/duplicate:seo.description",
      "seo:/dynamic:seo.description",
      "seo:/evalassign:seo.description",
      "seo:/evalhelper:seo.description",
      "seo:/inherited:seo.description",
      "seo:/mutatealias:seo.description",
      "seo:/mutateassign:seo.description",
      "seo:/mutated:seo.description",
      "seo:/mutateeval:seo.description",
      "seo:/namespaced:seo.description",
      "seo:/nested:seo.description",
      "seo:/nestedaccessor:seo.description",
      "seo:/protoassign:seo.description",
      "seo:/protoassignelement:seo.description",
      "seo:/protoassignnull:seo.description",
      "seo:/protoassignvalue:seo.description",
      "seo:/protodirect:seo.description",
      "seo:/protorobots:seo.description",
      "seo:/reachable:seo.description",
      "seo:/readafterwrite:seo.description",
      "seo:/reassigned:seo.description",
      "seo:/reexported:seo.description",
      "seo:/required:seo.description",
      "seo:/rest:seo.description",
      "seo:/returnspread:seo.description",
      "seo:/robotsaccessor:seo.description",
      "seo:/shadowed:seo.description",
      "seo:/sideeffect:seo.description",
      "seo:/spreadarg:seo.description",
      "seo:/starnamed:seo.description",
      "seo:/starred:seo.description",
      "seo:/twoargs:seo.description",
],
  );
});
