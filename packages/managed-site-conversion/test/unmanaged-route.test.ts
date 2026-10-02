import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import type { Proposal } from "../src/propose.js";
import { applyAnchorNames, nameAmbiguousAnchors } from "../src/name-anchors.js";
import { applyRewrite, planRewrite } from "../src/rewire.js";
import type { JsonValue } from "@landing-pages-websites/managed-site-contract";

import { isJsonObject } from "../src/json-write.js";
import { configFor, run, workspace, type Workspace } from "./support/proposals.js";

/**
 * The claim under test: `managedContent: false` gives a declared route its SEO
 * facts and no customer content.
 *
 * Every route the scan finds has to be declared or the descriptor is
 * incomplete, so an internal screen has to be declared too -- and declaring
 * one used to be the same as handing its labels to the customer. All Points
 * Media's password-gated `/admin` contributed seven editable fields to the
 * editor, 'Shared password' among them, on a page no customer can open.
 *
 * The rule is about the routes that REACH a declaration, never about the file.
 * A component rendered by both an internal screen and a public page is still
 * the customer's, in whichever order the routes are scanned, so the tests
 * below run the same fixture with the flag on each route in turn.
 */
const RUNTIME = "@/src/content/managed-site";

const ROUTES = ["/", "/admin"] as const;

/** The shared config, with `managedContent: false` on exactly the routes named. */
function configWithUnmanaged(unmanaged: readonly string[]): unknown {
  return configFor(ROUTES, (route) => ({
    managedContent: !unmanaged.includes(route),
  }));
}

function proposalFor(unmanaged: readonly string[]): Proposal {
  return run(workspace("unmanagedroute", configWithUnmanaged(unmanaged)));
}

/**
 * Every customer-editable value in the contract, read the way the editor
 * reads one: resolve the field's own resolver against the source document it
 * names. The presentation name is 'Heading text' for every heading, so a test
 * written against names cannot tell one page's words from another's.
 */
function editableValues(proposal: Proposal): readonly string[] {
  const values: string[] = [];
  for (const page of proposal.contract?.pages ?? []) {
    for (const section of page.sections) {
      for (const field of section.fields) {
        if (field.classification !== "customer_editable") continue;
        const value = field.resolver.pointer
          .slice(1)
          .split("/")
          .reduce<JsonValue | undefined>(
            (node, key) => (isJsonObject(node) ? node[key] : undefined),
            proposal.sourceDocuments.get(field.resolver.path),
          );
        if (typeof value === "string") values.push(value);
      }
    }
  }
  return values;
}

const PUBLIC_ONLY = "Words the customer owns";
const INTERNAL_ONLY = "Shared password";
const ADMIN_COMPONENT = "Rendered only by the internal screen";
const SHARED = "Shared between both routes";

test("a declared route still validates the contract when it owns no content", () => {
  const proposal = proposalFor(["/admin"]);

  assert.notEqual(proposal.contract, null, "the contract validates");
  assert.deepEqual(
    (proposal.contract?.pages ?? [])
      .map((page) => (page.route.kind === "static" ? page.route.path : page.route.pattern))
      .sort(),
    ["/", "/admin"],
    "the internal screen is still a page, so its SEO facts are carried",
  );
});

test("an unmanaged route offers the customer none of its own words", () => {
  const values = editableValues(proposalFor(["/admin"]));

  assert.equal(values.includes(INTERNAL_ONLY), false);
  assert.equal(values.includes(ADMIN_COMPONENT), false);
});

test("a component the unmanaged route shares with a public page stays the customer's", () => {
  const values = editableValues(proposalFor(["/admin"]));

  assert.equal(values.includes(SHARED), true);
  assert.equal(values.includes(PUBLIC_ONLY), true);
});

/**
 * The same claim with the routes swapped. `/` is scanned first, so a rule that
 * kept whichever declaration the first route reached would pass the test above
 * and fail this one: here the only route reaching the shared component with
 * content is the one scanned SECOND.
 */
test("reaching a component from any managed route is enough, whichever is scanned first", () => {
  const values = editableValues(proposalFor(["/"]));

  assert.equal(values.includes(SHARED), true);
  assert.equal(values.includes(INTERNAL_ONLY), true);
  assert.equal(values.includes(ADMIN_COMPONENT), true);
  assert.equal(values.includes(PUBLIC_ONLY), false);
});

/** Absence is not false: a route declared without the key behaves as it always did. */
test("declaring a route without the key leaves its words editable", () => {
  const values = editableValues(proposalFor([]));

  for (const value of [SHARED, PUBLIC_ONLY, INTERNAL_ONLY, ADMIN_COMPONENT]) {
    assert.equal(values.includes(value), true, `${value} is editable`);
  }
});

/** Marking every route unmanaged is a site with no content, not a crash. */
test("a site whose every route is unmanaged proposes nothing and still validates", () => {
  const proposal = proposalFor([...ROUTES]);

  assert.notEqual(proposal.contract, null);
  assert.deepEqual(editableValues(proposal), []);
});

/**
 * Fields are not the only thing a route offers. A collection and an asset slot
 * reach the contract through their own arrays, not through a page's sections,
 * so a suppression that only emptied `pages` would leave the operator
 * console's tool list and its screenshot in the customer's editor.
 */
test("an unmanaged route offers no collections and no asset slots either", () => {
  const unmanaged = proposalFor(["/admin"]);
  const managed = proposalFor([]);

  assert.deepEqual(unmanaged.contract?.collections, []);
  assert.deepEqual(unmanaged.contract?.assets, []);
  assert.notEqual(
    managed.contract?.collections.length,
    0,
    "the same fixture does propose a collection when the route is managed",
  );
  assert.notEqual(
    managed.contract?.assets.length,
    0,
    "and an asset slot",
  );
});

/**
 * The route keeps a content document, because that is where its SEO values
 * live and keeping those is the whole point of declaring it. What it must not
 * hold is a single key a customer could edit.
 */
test("an unmanaged route's document carries its SEO and nothing else", () => {
  const document = proposalFor(["/admin"]).sourceDocuments.get(
    "src/content/pages/admin.json",
  );

  assert.ok(isJsonObject(document));
  assert.deepEqual(Object.keys(document), ["seo"]);
  assert.deepEqual(
    Object.keys(
      (proposalFor([]).sourceDocuments.get("src/content/pages/admin.json") ??
        {}) as object,
    ).sort(),
    ["admin", "adminOnly", "seo"],
    "the same route managed carries its words beside the SEO",
  );
});

/**
 * The anchor pass is a second writer. It names the values the confidence gate
 * refused, and a value nobody proposed cannot be refused, so an internal
 * screen has nothing to name -- which is the only reason `managedContent` can
 * promise the route's markup is left alone. Converting All Points Media wrote
 * an `id` into its admin console before this existed.
 */
test("the anchor pass writes nothing into an unmanaged route", () => {
  const space = workspace("unmanagedroute", configWithUnmanaged(["/admin"]));
  const before = readFileSync(join(space.repositoryRoot, "app/admin/page.tsx"), "utf8");
  const componentBefore = readFileSync(
    join(space.repositoryRoot, "components/AdminOnly.tsx"),
    "utf8",
  );
  const named = nameAmbiguousAnchors(
    run(space).ambiguous,
    space.repositoryRoot,
  );
  applyAnchorNames(named.names);

  assert.equal(
    named.names.some((name) => name.file.includes("admin") || name.file.includes("AdminOnly")),
    false,
    "no name is proposed inside the internal screen",
  );
  assert.equal(readFileSync(join(space.repositoryRoot, "app/admin/page.tsx"), "utf8"), before);
  assert.equal(
    readFileSync(join(space.repositoryRoot, "components/AdminOnly.tsx"), "utf8"),
    componentBefore,
  );
});

function convert(unmanaged: readonly string[]): {
  readonly space: Workspace;
  readonly read: (relative: string) => string;
} {
  const space = workspace("unmanagedroute", configWithUnmanaged(unmanaged));
  applyRewrite(planRewrite(run(space), RUNTIME), RUNTIME);
  return {
    space,
    read: (relative) => readFileSync(join(space.repositoryRoot, relative), "utf8"),
  };
}

/**
 * What "leaves its markup alone" means, exactly.
 *
 * The route's OWN words stay literals and it gets no page root, so the editor
 * discovers nothing on it. A component it SHARES with a public page is a
 * different matter: that component is rewired for the customer, and a client
 * one reads its values from a prop its caller supplies. Skipping the caller
 * here would leave `managedFields` undefined on this route alone, so the
 * internal screen would render the literal the fixture shipped while every
 * public page rendered the customer's edit -- the same words, silently
 * disagreeing. The call site is updated for that reason and no other.
 */
test("the rewriter leaves an unmanaged route's own words alone", () => {
  const admin = convert(["/admin"]).read("app/admin/page.tsx");

  assert.equal(admin.includes("managedPage("), false, "no page root annotation");
  assert.match(admin, new RegExp(`<h2>${INTERNAL_ONLY}</h2>`, "u"));
  assert.match(admin, /<AdminOnly \/>/u);
});

test("a client component shared with a public page is threaded on both call sites", () => {
  const { read } = convert(["/admin"]);

  for (const caller of ["app/page.tsx", "app/admin/page.tsx"]) {
    assert.match(
      read(caller),
      /<Shared managedFields=\{managedFieldsFor\(\[/u,
      `${caller} supplies the shared client component its values`,
    );
  }
  assert.match(read("components/Shared.tsx"), /managedFields\?\.\[/u);
});

test("a server component shared with a public page reads the runtime directly", () => {
  const { read } = convert(["/admin"]);

  assert.match(read("components/Masthead.tsx"), /managedText\(/u);
  assert.equal(
    read("app/admin/page.tsx").includes("<Masthead />"),
    true,
    "a server component needs nothing threaded, so its call site is untouched",
  );
});

test("the rewriter still annotates the managed route beside it", () => {
  const { read } = convert(["/admin"]);

  assert.match(read("app/page.tsx"), /managedPage\(/u);
});

/**
 * A name is not an identity.
 *
 * Page attribution used to ask which routes render "a component called
 * AdminCard". Two modules may each declare one, so the public page's card
 * answered for the internal screen's too: the binding came out site-scoped,
 * its value was written to the shared document rather than the page's, and the
 * internal route counted as an owner of content it does not render — which,
 * now that a route may decline content, is the one thing `managedContent:
 * false` exists to prevent. The join is on `declarationKey`, which carries the
 * module and the position, so the two are never confused.
 */
const COLLIDING = ["/", "/admin"] as const;

function collisionProposal(unmanaged: readonly string[]): Proposal {
  return run(
    workspace(
      "namecollision",
      configFor(COLLIDING, (route) => ({
        managedContent: !unmanaged.includes(route),
      })),
    ),
  );
}

const PUBLIC_CARD = "The public card the customer owns";
const INTERNAL_CARD = "The internal card nobody may edit";

test("two components sharing a name are not one component", () => {
  const values = editableValues(collisionProposal(["/admin"]));

  assert.equal(values.includes(PUBLIC_CARD), true);
  assert.equal(values.includes(INTERNAL_CARD), false);
});

test("a same-named component on one route does not make the other's value site-scoped", () => {
  const proposal = collisionProposal(["/admin"]);
  // The card's OWN field, found by the value it carries. The home page has
  // another editable field beside it, and taking the first one tested the
  // paragraph instead -- which is page-scoped either way, so the test passed
  // with the name-based join still in place.
  const field = (proposal.contract?.pages ?? [])
    .flatMap((page) => page.sections)
    .flatMap((section) => section.fields)
    .find((entry) => {
      const document = proposal.sourceDocuments.get(entry.resolver.path);
      const value = entry.resolver.pointer
        .slice(1)
        .split("/")
        .reduce<JsonValue | undefined>(
          (node, key) => (isJsonObject(node) ? node[key] : undefined),
          document,
        );
      return value === PUBLIC_CARD;
    });

  assert.notEqual(field, undefined, "the public card is a field somewhere");
  assert.equal(field?.scope, "page", "not site, which the name collision produced");
  assert.equal(
    field?.resolver.path,
    "src/content/pages/home.json",
    "and it is written to the page's own document, not the shared one",
  );
});

/**
 * With both routes managed the two cards collide on one anchor,
 * `component:AdminCard/role:h2/text`, and the confidence gate withholds BOTH
 * and names them rather than letting whichever was walked first win. That is
 * the pre-existing refusal, and it is what makes the test above meaningful:
 * the public card is proposed only because declining the internal route left
 * nothing to collide with, never because a name-based join picked one.
 */
test("both routes managed, the shared name is refused rather than resolved", () => {
  const proposal = collisionProposal([]);
  const duplicates = proposal.report.findings.filter(
    (finding) => finding.code === "DUPLICATE_COMPONENT_NAME",
  );

  assert.equal(duplicates.length, 2, "both cards are named, not one");
  assert.deepEqual(
    [...new Set(duplicates.map((finding) => finding.anchor))],
    ["component:AdminCard/role:h2/text"],
  );
  const values = editableValues(proposal);
  assert.equal(values.includes(PUBLIC_CARD), false);
  assert.equal(values.includes(INTERNAL_CARD), false);
});
