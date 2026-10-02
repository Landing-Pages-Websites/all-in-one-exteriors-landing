import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ManagedSiteContractError } from "../src/index.js";
import {
  migrationCase,
  refreshFrom,
  steps,
  verifyCase,
  type Json,
  type MigrationCase,
} from "./field-migration-fixture.js";

/**
 * A declared migration retires fields, and its own rule compares the outline
 * entries that named them. Everything else (routes, redirects, business
 * identity and every other page SEO fact) is the ordinary URL and SEO rule's,
 * run with the retired fields excluded. These cases change only that
 * "everything else" in All Points Media #73's real migration.
 */

const ACCEPTED = "ACCEPTED";

function outcome(migration: MigrationCase): string {
  try {
    verifyCase(migration);
    return ACCEPTED;
  } catch (error) {
    if (error instanceof ManagedSiteContractError) return error.code;
    throw error;
  }
}

function seo(contract: Json): Json {
  return contract.internalSeo as Json;
}

function seoPages(contract: Json): Json[] {
  return seo(contract).pages as Json[];
}

function pages(contract: Json): Json[] {
  return contract.pages as Json[];
}

function redirects(contract: Json): Json[] {
  return seo(contract).redirects as Json[];
}

/** Field ids a step consumes or creates: the entries the migration's own rule owns. */
function migratedIds(migration: MigrationCase): ReadonlySet<string> {
  return new Set(steps(migration).flatMap((step) => [
    step.target as string,
    ...(step.parts as Json[]).flatMap((part) => (typeof part.source === "string" ? [part.source] : [])),
  ]));
}

const PAGE = "page_95xvhcrhz1q3rw0s49f4a94xtw";
const UNMIGRATED_HEADING = `field_${"9".repeat(25)}0`;

function outline(contract: Json, pageId = PAGE): Json[] {
  return (seoPages(contract).find((page) => page.pageId === pageId) as Json).headingOutline as Json[];
}

/**
 * Declares, on both sides, a level 2 heading field on PAGE that no step
 * touches (every heading in #73 is migrated), with the same value.
 */
function declareUnmigratedHeading(migration: MigrationCase): void {
  for (const contract of [migration.productionContract, migration.candidateContract]) {
    const page = pages(contract).find((entry) => entry.id === PAGE) as Json;
    ((page.sections as Json[])[0].fields as Json[]).push({
      capabilities: ["text.edit"],
      classification: "customer_editable",
      constraints: { maxLength: 300, minLength: 1, newlines: "forbid" },
      id: UNMIGRATED_HEADING,
      presentation: { description: null, example: null, group: "Unmigrated", name: "Heading text", order: 999 },
      resolver: { kind: "json_pointer", path: "src/content/pages/unmigrated.json", pointer: "/heading" },
      scope: "page",
      semanticLevel: 2,
      type: "heading_text",
      usages: [{ itemId: null, pageId: PAGE }],
    });
  }
  for (const content of [migration.productionContent, migration.candidateContent]) {
    (content.values as Json[]).push({ fieldId: UNMIGRATED_HEADING, owner: { kind: "page", pageId: PAGE }, type: "heading_text", value: "Unmigrated" });
  }
}

/**
 * Gives production and candidate the same outline entry naming a heading no
 * step touches, re-signs the declaration, and returns the candidate's entry.
 */
function unmigratedOutlineEntry(migration: MigrationCase): Json {
  if (migratedIds(migration).has(UNMIGRATED_HEADING)) throw new Error("The heading is migrated");
  declareUnmigratedHeading(migration);
  for (const contract of [migration.productionContract, migration.candidateContract]) {
    outline(contract).push({ fieldId: UNMIGRATED_HEADING, semanticLevel: 2 });
  }
  refreshFrom(migration);
  return outline(migration.candidateContract).at(-1) as Json;
}

/** Adds the same redirect to production and candidate, then re-signs the declaration. */
function withRedirect(migration: MigrationCase): MigrationCase {
  const [home] = pages(migration.productionContract);
  for (const contract of [migration.productionContract, migration.candidateContract]) {
    redirects(contract).push({ fromPath: "/old-home", destination: { kind: "page", pageId: home.id }, status: 301, preserveQuery: true });
  }
  refreshFrom(migration);
  return migration;
}

/**
 * Gives PAGE the same JSON-LD declaration on both sides, sourced from a field
 * no step touches, whose output properties are literals: `production` on
 * production and `candidate` on the candidate.
 */
function withJsonLdLiterals(migration: MigrationCase, production: Json, candidate: Json): void {
  const source = (seo(migration.productionContract).businessIdentity as Json).legalName;
  for (const [contract, literals] of [[migration.productionContract, production], [migration.candidateContract, candidate]] as const) {
    const page = seoPages(contract).find((entry) => entry.pageId === PAGE) as Json;
    (page.jsonLd as Json[]).push({ schemaType: "LocalBusiness", required: true, sourceFieldIds: [source], requiredOutputProperties: ["name"], ...literals });
  }
  refreshFrom(migration);
}

/** A field the migration retires and the target it becomes. */
function retired(migration: MigrationCase): readonly [source: string, target: string] {
  const [step] = steps(migration);
  const part = (step.parts as Json[]).find((entry) => typeof entry.source === "string") as Json;
  return [part.source as string, step.target as string];
}

type Case = readonly [name: string, mutate: (migration: MigrationCase) => void, code: string];

const cases: readonly Case[] = [
  ["the real migration, with retired outline entries left to its own rule", () => undefined, ACCEPTED],
  ["the real migration with a redirect kept", (m) => void withRedirect(m), ACCEPTED],
  ["the real migration with an unmigrated outline entry kept", (m) => void unmigratedOutlineEntry(m), ACCEPTED],
  ["a page moved with no redirect", (m) => void (pages(m.candidateContract)[1].route = { kind: "static", path: "/about-us" }), "COMPATIBILITY_ROUTE_REMOVED"],
  ["a production redirect dropped", (m) => void redirects(withRedirect(m).candidateContract).splice(0, 1), "COMPATIBILITY_REDIRECT_REMOVED"],
  ["a production redirect made temporary", (m) => void (redirects(withRedirect(m).candidateContract)[0].status = 302), "COMPATIBILITY_REDIRECT_CHANGED"],
  ["a production redirect retargeted, which a migration cannot list", (m) => {
    const candidate = withRedirect(m).candidateContract;
    redirects(candidate)[0].destination = { kind: "page", pageId: pages(candidate)[1].id };
  }, "COMPATIBILITY_REDIRECT_CHANGED"],
  ["a page moved behind a redirect, with its canonical already naming the new path", (m) => {
    const [, about] = pages(m.candidateContract);
    const canonicalField = ((seoPages(m.productionContract).find((page) => page.pageId === about.id) as Json).metadata as Json).canonical;
    for (const content of [m.productionContent, m.candidateContent]) {
      const value = (content.values as Json[]).find((entry) => entry.fieldId === canonicalField);
      if (value === undefined) throw new Error("Missing canonical value");
      value.value = "https://www.allpointsco.com/moved";
    }
    refreshFrom(m);
    about.route = { kind: "static", path: "/moved" };
    redirects(m.candidateContract).push({ fromPath: (pages(m.productionContract)[1].route as Json).path, destination: { kind: "page", pageId: about.id }, status: 301, preserveQuery: true });
  }, "COMPATIBILITY_ROUTE_REMOVED"],
  ["a redirect added", (m) => {
    redirects(m.candidateContract).push({ fromPath: "/new-alias", destination: { kind: "page", pageId: pages(m.candidateContract)[0].id }, status: 301, preserveQuery: true });
  }, "COMPATIBILITY_REDIRECT_CHANGED"],
  ["the telephone re-pointed", (m) => {
    const identity = seo(m.candidateContract).businessIdentity as Json;
    identity.telephone = identity.legalName;
  }, "COMPATIBILITY_SEO_IDENTITY_CHANGED"],
  ["an unmigrated outline entry dropped", (m) => {
    const entry = unmigratedOutlineEntry(m);
    outline(m.candidateContract).splice(outline(m.candidateContract).indexOf(entry), 1);
  }, "COMPATIBILITY_PAGE_SEO_CHANGED"],
  // Its field renders an h2, so contract semantics refuse another outline level.
  ["an unmigrated outline entry re-levelled", (m) => void (unmigratedOutlineEntry(m).semanticLevel = 3), "CONTRACT_SEO_FIELD_POLICY"],
  ["an unmigrated heading made the page's H1, field and outline both", (m) => {
    unmigratedOutlineEntry(m).semanticLevel = 1;
    const page = pages(m.candidateContract).find((entry) => entry.id === PAGE) as Json;
    const field = ((page.sections as Json[])[0].fields as Json[]).find((entry) => entry.id === UNMIGRATED_HEADING) as Json;
    field.semanticLevel = 1;
  }, "COMPATIBILITY_FIELD_POLICY_NARROWED"],
  // A migration renames only registered field references: a JSON-LD literal
  // equal to a retired id is a literal, and changing it changes the page.
  ["a JSON-LD output property equal to a retired field, renamed with it", (m) => {
    const [source, target] = retired(m);
    withJsonLdLiterals(m, { requiredOutputProperties: [source] }, { requiredOutputProperties: [target] });
  }, "COMPATIBILITY_PAGE_SEO_CHANGED"],
  ["a JSON-LD schema type equal to a retired field, renamed with it", (m) => {
    const [source, target] = retired(m);
    withJsonLdLiterals(m, { schemaType: source }, { schemaType: target });
  }, "COMPATIBILITY_PAGE_SEO_CHANGED"],
  ["a JSON-LD output property equal to a retired field, kept verbatim", (m) => {
    const [source] = retired(m);
    withJsonLdLiterals(m, { requiredOutputProperties: [source] }, { requiredOutputProperties: [source] });
  }, ACCEPTED],
  ["a page title re-pointed to another page's protected title", (m) => {
    const [first, second] = seoPages(m.candidateContract);
    (first.metadata as Json).title = (second.metadata as Json).title;
  }, "COMPATIBILITY_PAGE_SEO_CHANGED"],
];

describe("migration: the ordinary URL and SEO rule still holds outside the migration", () => {
  for (const [name, mutate, code] of cases) {
    it(name, () => {
      const migration = migrationCase();
      mutate(migration);
      assert.equal(outcome(migration), code);
    });
  }
});

describe("migration: where targets sit relative to unmigrated headings is listed", () => {
  type Placement = readonly [name: string, place: (m: MigrationCase, entry: Json) => void, listed: boolean];
  const placements: readonly Placement[] = [
    ["kept first on both sides", (m, entry) => void outline(m.candidateContract).unshift(entry), false],
    ["moved below every target", (m, entry) => void outline(m.candidateContract).push(entry), true],
    ["moved between two targets", (m, entry) => void outline(m.candidateContract).splice(2, 0, entry), true],
    ["kept first, with a second copy added last", (m, entry) => {
      outline(m.candidateContract).unshift(entry);
      outline(m.candidateContract).push(structuredClone(entry));
    }, false],
  ];
  for (const [name, place, listed] of placements) {
    it(`an unmigrated heading ${name}`, () => {
      const migration = migrationCase();
      declareUnmigratedHeading(migration);
      const entry = { fieldId: UNMIGRATED_HEADING, semanticLevel: 2 };
      outline(migration.productionContract).unshift(structuredClone(entry));
      place(migration, structuredClone(entry));
      refreshFrom(migration);
      const reorders = verifyCase(migration).added.filter(
        (item) => item.kind === "seo_reordered" && (item as { readonly path: string }).path.includes(PAGE),
      );
      assert.equal(reorders.length, listed ? 1 : 0);
      if (listed) assert.ok(JSON.stringify((reorders[0] as { readonly to: unknown }).to).includes(UNMIGRATED_HEADING));
    });
  }

  it("lists two migrated targets that swap places, as the ordinary rule lists any reorder", () => {
    const migration = migrationCase();
    const entries = outline(migration.candidateContract);
    entries.push(entries.shift() as Json);
    const reorders = verifyCase(migration).added.filter((item) => item.kind === "seo_reordered");
    assert.deepEqual(reorders.map((item) => (item as { readonly path: string }).path), [`internalSeo.pages[${PAGE}].headingOutline`]);
  });
});

describe("migration: a page with no H1 may declare its H1, listed as the ordinary result lists it", () => {
  it("lists a level 1 heading field added to a page with none", () => {
    const migration = migrationCase();
    const page = pages(migration.candidateContract).find((entry) => entry.id === PAGE) as Json;
    const fields = (page.sections as Json[])[0].fields as Json[];
    const id = `field_${"6".repeat(25)}0`;
    fields.push({
      capabilities: ["text.edit"], classification: "customer_editable",
      constraints: { maxLength: 300, minLength: 1, newlines: "forbid" }, id,
      presentation: { description: null, example: null, group: "Hero", name: "Headline", order: 998 },
      resolver: { kind: "json_pointer", path: "src/content/pages/headline.json", pointer: "/headline" },
      scope: "page", semanticLevel: 1, type: "heading_text", usages: [{ itemId: null, pageId: PAGE }],
    });
    (migration.candidateContent.values as Json[]).push({ fieldId: id, owner: { kind: "page", pageId: PAGE }, type: "heading_text", value: "Headline" });
    const adopted = verifyCase(migration).added.filter((item) => item.kind === "h1_adopted");
    assert.deepEqual(adopted, [{ kind: "h1_adopted", pageId: PAGE, fieldIds: [id] }]);
  });
});
