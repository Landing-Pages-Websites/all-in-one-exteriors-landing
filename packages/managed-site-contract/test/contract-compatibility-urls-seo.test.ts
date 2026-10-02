import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ManagedSiteContractError,
  parseManagedSiteContentDocument,
  parseManagedSiteContractV1,
  validateManagedSiteContractV1Compatibility,
  validateManagedSiteContractV1ContentSemantics,
  managedPageH1Fields,
  managedRenderedH1Sources,
} from "../src/index.js";
import { MANAGED_REDIRECT_FIELDS_WITH_THEIR_OWN_RULE } from "../src/contract-compatibility-routes.js";
import {
  comparedSeoSections,
  MANAGED_SEO_FACTS_NOT_COMPARED,
  MANAGED_SEO_SECTIONS_WITH_OPEN_SLOTS,
  MANAGED_SEO_SECTIONS_WITH_THEIR_OWN_RULE,
  orderFreeSeoLists,
  seoFactRules,
} from "../src/contract-compatibility-seo.js";
import { isPreservedBy } from "../src/contract-compatibility-seo-facts.js";
import { MANAGED_SITE_CONTRACT_OCCURRENCE_REGISTRY } from "../src/contract-occurrence-registry.js";
import { managedSiteSeoDescriptorSchema } from "../src/seo.js";
import { contentSemanticsFixture } from "./content-semantics-fixture.js";
import { fixtureId } from "./contract-semantics-fixture.js";
import { editableSeoFixture } from "./editable-seo-fixture.js";

type JsonObject = Record<string, unknown>;

interface Fixture {
  readonly contract: JsonObject;
  readonly content: JsonObject;
  readonly ids: Readonly<Record<string, string>>;
}

type Mutation = (fixture: Fixture) => void;

interface Case {
  readonly name: string;
  readonly production?: Mutation;
  readonly candidate: Mutation;
  readonly code?: string;
}

const ACCEPTED = "ACCEPTED";

function objects(value: unknown): JsonObject[] {
  return value as JsonObject[];
}

function object(value: unknown): JsonObject {
  return value as JsonObject;
}

function seo(fixture: Fixture): JsonObject {
  return object(fixture.contract.internalSeo);
}

function page(fixture: Fixture, pageId: string): JsonObject {
  const found = objects(fixture.contract.pages).find((entry) => entry.id === pageId);
  if (found === undefined) throw new Error(`Missing page ${pageId}`);
  return found;
}

function pageSeo(fixture: Fixture, pageId = fixture.ids.homePage): JsonObject {
  const entries = [...objects(seo(fixture).pages), ...objects(seo(fixture).generatedPages)];
  const found = entries.find((entry) => entry.pageId === pageId);
  if (found === undefined) throw new Error(`Missing SEO entry ${pageId}`);
  return found;
}

function generatedSeo(fixture: Fixture): JsonObject {
  return pageSeo(fixture, fixture.ids.generatedPage);
}

function redirects(fixture: Fixture): JsonObject[] {
  return objects(seo(fixture).redirects);
}

function identity(fixture: Fixture): JsonObject {
  return object(seo(fixture).businessIdentity);
}

function contentValues(fixture: Fixture): JsonObject[] {
  return objects(fixture.content.values);
}

/**
 * A second protected field with the same descriptor and value as `fieldId`,
 * so re-pointing an SEO slot to it is valid and publishes the same text: the
 * refusal is about the reference, not the value.
 */
function cloneProtectedField(fixture: Fixture, fieldId: string): string {
  const id = fixtureId("field");
  const holders = [
    objects(seo(fixture).protectedFields),
    ...objects(fixture.contract.collections).map((collection) => objects(collection.itemFields)),
  ];
  const holder = holders.find((fields) => fields.some((field) => field.id === fieldId));
  const descriptor = holder?.find((field) => field.id === fieldId);
  if (holder === undefined || descriptor === undefined) throw new Error(`Missing ${fieldId}`);
  const clone: JsonObject = { ...structuredClone(descriptor), id };
  if (typeof clone.itemPointer === "string") clone.itemPointer = `${clone.itemPointer}Copy`;
  else object(clone.resolver).pointer = `${object(clone.resolver).pointer as string}Copy`;
  holder.push(clone);
  for (const value of contentValues(fixture).filter((entry) => entry.fieldId === fieldId)) {
    contentValues(fixture).push({ ...structuredClone(value), fieldId: id });
  }
  return id;
}

/** Declares a heading field at `level` on a page, with a value, and returns its id. */
function addHeading(fixture: Fixture, level: number, pageId = fixture.ids.homePage): string {
  const id = fixtureId("field");
  const title = objects(fixture.contract.pages)
    .flatMap((entry) => objects(entry.sections).flatMap((section) => objects(section.fields)))
    .find((field) => field.type === "heading_text");
  if (title === undefined) throw new Error("The fixture declares no heading field");
  objects(objects(page(fixture, pageId).sections)[0].fields).push({
    ...structuredClone(title),
    id,
    scope: "page",
    semanticLevel: level,
    usages: [{ pageId, itemId: null }],
    resolver: { kind: "json_pointer", path: "content/site.json", pointer: `/headings/${id}` },
  });
  contentValues(fixture).push({ fieldId: id, owner: { kind: "page", pageId }, type: "heading_text", value: `Heading ${id}` });
  return id;
}

/** Adds a heading at `level` to a page's outline, after what it has. */
function addOutlined(level: number, pageId?: string): Mutation {
  return (f) => {
    const id = addHeading(f, level, pageId ?? f.ids.homePage);
    outline(f, pageId ?? f.ids.homePage).push({ fieldId: id, semanticLevel: level });
  };
}

function outline(fixture: Fixture, pageId = fixture.ids.homePage): JsonObject[] {
  return objects(pageSeo(fixture, pageId).headingOutline);
}

interface AboutSeo {
  readonly index: boolean;
  readonly canonical: string | null;
  readonly indexingOwner: "page" | "site";
}

/** A protected field like `from`, used on the about page, with one value. */
function aboutProtected(f: Fixture, from: string, owner: "page" | "site", value: unknown): string {
  const original = objects(seo(f).protectedFields).find((entry) => entry.id === from);
  const production = contentValues(f).find((entry) => entry.fieldId === from);
  if (original === undefined || production === undefined) throw new Error(`Missing protected ${from}`);
  const id = fixtureId("field");
  objects(seo(f).protectedFields).push({
    ...structuredClone(original),
    id,
    scope: owner === "site" ? "site" : "page",
    usages: [{ pageId: f.ids.aboutPage, itemId: null }],
    resolver: { kind: "json_pointer", path: "content/site.json", pointer: `/seo/about/${id}` },
  });
  const valueOwner = owner === "site" ? { kind: "site" } : { kind: "page", pageId: f.ids.aboutPage };
  contentValues(f).push({ ...structuredClone(production), fieldId: id, owner: valueOwner, value });
  return id;
}

/**
 * Gives the about page its own indexing and canonical values, so a redirect
 * may land on it when it is indexed at its own URL.
 */
function aboutSeo({ index, canonical, indexingOwner }: AboutSeo): Mutation {
  return (f) => {
    const metadata = object(pageSeo(f, f.ids.aboutPage).metadata);
    const indexing = contentValues(f).find((entry) => entry.fieldId === f.ids.protectedIndexing);
    metadata.indexing = aboutProtected(f, f.ids.protectedIndexing, indexingOwner, { ...object(indexing?.value), index });
    if (canonical !== null) metadata.canonical = aboutProtected(f, f.ids.protectedCanonical, "page", canonical);
  };
}

const aboutIndexed = aboutSeo({ index: true, canonical: "https://example.com/about", indexingOwner: "page" });

function setRoute(fixture: Fixture, pageId: string, path: string): void {
  page(fixture, pageId).route = { kind: "static", path };
}

function redirect(fromPath: string, pageId: string, status = 301): JsonObject {
  return { fromPath, destination: { kind: "page", pageId }, status, preserveQuery: true };
}

/** Production publishes `url` as the home page's canonical. */
function canonicalAt(url: string): Mutation {
  return (f) => {
    const value = contentValues(f).find((entry) => entry.fieldId === f.ids.protectedCanonicalField);
    if (value === undefined) throw new Error("Missing canonical value");
    value.value = url;
  };
}

function moveHome(overrides: JsonObject = {}): Mutation {
  return (f) => {
    setRoute(f, f.ids.homePage, "/home");
    redirects(f).push({ ...redirect("/", f.ids.homePage), ...overrides });
  };
}

function external(url: string): JsonObject {
  return { kind: "external", url };
}

function parsed(fixture: Fixture) {
  return {
    contract: parseManagedSiteContractV1(fixture.contract),
    content: parseManagedSiteContentDocument(fixture.content),
  };
}

function outcome(production: Fixture, candidate: Fixture): string {
  const before = parsed(production);
  const after = parsed(candidate);
  try {
    validateManagedSiteContractV1Compatibility(before.contract, before.content, after.contract, after.content);
    return ACCEPTED;
  } catch (error) {
    if (error instanceof ManagedSiteContractError) return error.code;
    throw error;
  }
}

function runCases(base: () => Fixture, cases: readonly Case[]): void {
  for (const testCase of cases) {
    it(testCase.name, () => {
      const production = base();
      testCase.production?.(production);
      const candidate = structuredClone(production) as Fixture;
      testCase.candidate(candidate);
      assert.equal(outcome(production, candidate), testCase.code ?? ACCEPTED);
    });
  }
}

const base = (): Fixture => contentSemanticsFixture() as unknown as Fixture;
const withAbout = (): Fixture => editableSeoFixture() as unknown as Fixture;


const RICH_H1 = `field_${"3".repeat(25)}0`;
const RICH_H1_SECTION = `section_${"2".repeat(25)}0`;

/**
 * A home page whose H1 is a rich-text field holding one level 1 heading block
 * (contract 0.14.0), named first in the page's heading outline.
 */
function withRichH1(): Fixture {
  const f = base();
  objects(objects(f.contract.pages)[0].sections).push({
    id: RICH_H1_SECTION,
    presentation: { name: "Hero", description: null, group: "Hero", order: 1, example: null },
    fields: [{
      id: RICH_H1,
      scope: "page",
      type: "rich_text",
      classification: "customer_editable",
      capabilities: ["text.edit", "rich_text.mark.bold"],
      resolver: { kind: "json_pointer", path: "content/site.json", pointer: "/hero/h1" },
      usages: [{ pageId: f.ids.homePage, itemId: null }],
      presentation: { name: "Page heading", description: null, group: "Hero", order: 1, example: null },
      constraints: {
        maxCharacters: 200, maxNodes: 20, maxBlocks: 1, allowedBlocks: ["heading"], allowedMarks: ["bold"],
        allowLinks: false, allowedExternalHosts: [], allowedTargets: [],
      },
    }],
  });
  contentValues(f).push({
    fieldId: RICH_H1,
    owner: { kind: "page", pageId: f.ids.homePage },
    type: "rich_text",
    value: { type: "doc", content: [{ type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Welcome", marks: [{ type: "bold" }] }] }] },
  });
  pageSeo(f).headingOutline = [{ fieldId: RICH_H1, semanticLevel: 1 }];
  addOutlined(2)(f);
  return f;
}

describe("compatibility: the reviewer's probe", () => {
  const probe: Mutation = (f) => {
    redirects(f).splice(0, 1);
    setRoute(f, f.ids.aboutPage, "/zzz");
    identity(f).telephone = f.ids.bodyField;
  };
  runCases(withAbout, [
    { name: "refuses all three changes together", candidate: probe, code: "COMPATIBILITY_ROUTE_REMOVED" },
    { name: "refuses dropping the 301 alone", candidate: (f) => void redirects(f).splice(0, 1), code: "COMPATIBILITY_REDIRECT_REMOVED" },
    { name: "refuses /about to /zzz alone", candidate: (f) => setRoute(f, f.ids.aboutPage, "/zzz"), code: "COMPATIBILITY_ROUTE_REMOVED" },
    { name: "refuses re-pointing the telephone alone", candidate: (f) => void (identity(f).telephone = f.ids.bodyField), code: "COMPATIBILITY_SEO_IDENTITY_CHANGED" },
  ]);
});

describe("compatibility: production routes stay served", () => {
  runCases(withAbout, [
    { name: "accepts an unchanged pair", candidate: () => undefined },
    { name: "refuses a moved path with no redirect", candidate: (f) => setRoute(f, f.ids.aboutPage, "/about-us"), code: "COMPATIBILITY_ROUTE_REMOVED" },
    { name: "refuses a moved path behind a 302", candidate: (f) => { setRoute(f, f.ids.aboutPage, "/about-us"); redirects(f).push(redirect("/about", f.ids.aboutPage, 302)); }, code: "COMPATIBILITY_ROUTE_REMOVED" },
    { name: "refuses a moved path behind a 307", candidate: (f) => { setRoute(f, f.ids.aboutPage, "/about-us"); redirects(f).push(redirect("/about", f.ids.aboutPage, 307)); }, code: "COMPATIBILITY_ROUTE_REMOVED" },
    { name: "refuses a moved path redirected to another page", candidate: (f) => { setRoute(f, f.ids.aboutPage, "/about-us"); redirects(f).push(redirect("/about", f.ids.homePage)); }, code: "COMPATIBILITY_ROUTE_REMOVED" },
    { name: "refuses a moved path redirected off-site", candidate: (f) => { setRoute(f, f.ids.aboutPage, "/about-us"); redirects(f).push({ ...redirect("/about", f.ids.aboutPage), destination: external("https://example.com/about") }); }, code: "COMPATIBILITY_ROUTE_REMOVED" },
    { name: "refuses two pages swapping their paths", candidate: (f) => { setRoute(f, f.ids.aboutPage, "/"); setRoute(f, f.ids.homePage, "/about"); }, code: "COMPATIBILITY_ROUTE_REMOVED" },
    { name: "refuses a case-only path change", candidate: (f) => setRoute(f, f.ids.aboutPage, "/About"), code: "COMPATIBILITY_ROUTE_REMOVED" },
  ]);
  runCases(base, [
    // URL moves are blocked until Site Guard checks code and content as one.
    { name: "refuses a move behind a 301 even when the canonical already names the new path", production: canonicalAt("https://example.com/home"), candidate: moveHome(), code: "COMPATIBILITY_ROUTE_REMOVED" },
    { name: "refuses a move behind a 308 even when the canonical already names the new path", production: canonicalAt("https://example.com/home"), candidate: moveHome({ status: 308 }), code: "COMPATIBILITY_ROUTE_REMOVED" },
    { name: "refuses a move whose canonical names the new path with a trailing slash", production: canonicalAt("https://example.com/home/"), candidate: moveHome(), code: "COMPATIBILITY_ROUTE_REMOVED" },
    { name: "refuses a static page made generated", candidate: (f) => void (page(f, f.ids.homePage).route = { ...object(page(f, f.ids.generatedPage).route), pattern: "/home/[slug]" }), code: "CONTRACT_SEO_PAGE_ROUTE" },
    { name: "refuses a move whose canonical still names the old path", candidate: moveHome(), code: "COMPATIBILITY_ROUTE_REMOVED" },
    { name: "refuses a move whose canonical names the new path on another site", production: canonicalAt("https://competitor.example/home"), candidate: moveHome(), code: "COMPATIBILITY_ROUTE_REMOVED" },
    { name: "refuses a move whose canonical names the new path in another case", production: canonicalAt("https://example.com/Home"), candidate: moveHome(), code: "COMPATIBILITY_ROUTE_REMOVED" },
    { name: "refuses a move whose redirect drops the query", production: canonicalAt("https://example.com/home"), candidate: moveHome({ preserveQuery: false }), code: "COMPATIBILITY_ROUTE_REMOVED" },
    { name: "refuses a move whose canonical carries a query", production: canonicalAt("https://example.com/home?utm=x"), candidate: moveHome(), code: "COMPATIBILITY_ROUTE_REMOVED" },
    { name: "refuses a move while another page's canonical names the old path", production: (f) => {
      canonicalAt("https://example.com/home")(f);
      const value = contentValues(f).find((entry) => entry.fieldId === f.ids.generatedCanonicalField);
      if (value !== undefined) value.value = "https://example.com/";
    }, candidate: moveHome(), code: "COMPATIBILITY_ROUTE_REMOVED" },
    { name: "refuses a move behind a 302 even with a matching canonical", production: canonicalAt("https://example.com/home"), candidate: moveHome({ status: 302 }), code: "COMPATIBILITY_ROUTE_REMOVED" },
    { name: "refuses a changed generated pattern", candidate: (f) => void (object(page(f, f.ids.generatedPage).route).pattern = "/service/[slug]"), code: "COMPATIBILITY_ROUTE_REMOVED" },
    // A valid second route key needs its own uniqueness rule, which the older
    // collection check refuses first; the route rule would refuse it as well.
    { name: "refuses a generated route keyed by another field", candidate: (f) => {
      const key = cloneProtectedField(f, f.ids.routeKeyField);
      object(page(f, f.ids.generatedPage).route).routeKeyFieldId = key;
      objects(objects(f.contract.collections)[0].uniqueness).push({ fieldIds: [key], comparison: "exact" });
    }, code: "COMPATIBILITY_COLLECTION_POLICY_NARROWED" },
  ]);
});

describe("compatibility: production redirects are preserved", () => {
  const first = (f: Fixture): JsonObject => redirects(f)[0];
  const externalProduction: Mutation = (f) => void (first(f).destination = external("https://example.com/old"));
  const temporaryProduction: Mutation = (f) => void (first(f).status = 302);
  const permanent308: Mutation = (f) => void (first(f).status = 308);
  runCases(withAbout, [
    { name: "accepts an added redirect", candidate: (f) => void redirects(f).push(redirect("/older", f.ids.aboutPage)) },
    { name: "accepts a target moved to another indexable static page", production: aboutIndexed, candidate: (f) => void (first(f).destination = { kind: "page", pageId: f.ids.aboutPage }) },
    ...([
      ["a noindex page", aboutSeo({ index: false, canonical: "https://example.com/about", indexingOwner: "page" })],
      ["a page with no indexing or canonical value of its own", () => undefined],
      ["a page whose canonical names another URL", aboutSeo({ index: true, canonical: "https://example.com/somewhere-else", indexingOwner: "page" })],
      ["a page with no canonical value of its own", aboutSeo({ index: true, canonical: null, indexingOwner: "page" })],
      ["a page indexed only by a site-wide value", aboutSeo({ index: true, canonical: "https://example.com/about", indexingOwner: "site" })],
      ["a page whose canonical names its path on another site", aboutSeo({ index: true, canonical: "https://competitor.example/about", indexingOwner: "page" })],
    ] as const).map(([what, production]): Case => ({
      name: `refuses a target moved to ${what}`,
      production,
      candidate: (f) => void (first(f).destination = { kind: "page", pageId: f.ids.aboutPage }),
      code: "COMPATIBILITY_REDIRECT_CHANGED",
    })),
    { name: "refuses an external target moved to a noindex page", production: (f) => { aboutSeo({ index: false, canonical: "https://example.com/about", indexingOwner: "page" })(f); first(f).destination = external("https://example.com/old"); }, candidate: (f) => void (first(f).destination = { kind: "page", pageId: f.ids.aboutPage }), code: "COMPATIBILITY_REDIRECT_CHANGED" },
    { name: "accepts an external target moved to a static page", production: externalProduction, candidate: (f) => void (first(f).destination = { kind: "page", pageId: f.ids.homePage }) },
    { name: "accepts a temporary status made permanent", production: temporaryProduction, candidate: (f) => void (first(f).status = 301) },
    { name: "accepts a temporary status kept temporary", production: temporaryProduction, candidate: (f) => void (first(f).status = 307) },
    { name: "accepts 308 to 301", production: permanent308, candidate: (f) => void (first(f).status = 301) },
    { name: "refuses a removed redirect", candidate: (f) => void redirects(f).splice(0, 1), code: "COMPATIBILITY_REDIRECT_REMOVED" },
    { name: "refuses a redirect moved to another path", candidate: (f) => void (first(f).fromPath = "/older"), code: "COMPATIBILITY_REDIRECT_REMOVED" },
    { name: "refuses 301 to 302", candidate: (f) => void (first(f).status = 302), code: "COMPATIBILITY_REDIRECT_CHANGED" },
    { name: "refuses 308 to 307", production: permanent308, candidate: (f) => void (first(f).status = 307), code: "COMPATIBILITY_REDIRECT_CHANGED" },
    { name: "refuses a page target moved off-site", candidate: (f) => void (first(f).destination = external("https://example.com/")), code: "COMPATIBILITY_REDIRECT_CHANGED" },
    { name: "refuses an external target moved to another host", production: externalProduction, candidate: (f) => void (first(f).destination = external("https://example.org/old")), code: "COMPATIBILITY_REDIRECT_CHANGED" },
    { name: "refuses dropping the query", candidate: (f) => void (first(f).preserveQuery = false), code: "COMPATIBILITY_REDIRECT_CHANGED" },
    { name: "refuses starting to forward the query", production: (f) => void (first(f).preserveQuery = false), candidate: (f) => void (first(f).preserveQuery = true), code: "COMPATIBILITY_REDIRECT_CHANGED" },
  ]);
  runCases(base, [
    { name: "refuses a target moved to a generated page", candidate: (f) => void (first(f).destination = { kind: "page", pageId: f.ids.generatedPage }), code: "COMPATIBILITY_REDIRECT_CHANGED" },
  ]);
});

function identityCases(): Case[] {
  const keys = Object.entries(identity(base()));
  const held = keys.filter(([, value]) => value !== null).map(([key]) => key);
  const open = keys.filter(([, value]) => value === null).map(([key]) => key);
  // Which keys the schema lets a candidate clear, asked of the parser itself.
  const clearable = (key: string): boolean => {
    const probe = base();
    identity(probe)[key] = null;
    try {
      parseManagedSiteContractV1(probe.contract);
      return true;
    } catch {
      return false;
    }
  };
  return [
    ...held.map((key): Case => ({
      name: `refuses re-pointing ${key}`,
      candidate: (f) => void (identity(f)[key] = f.ids.bodyField),
      code: "COMPATIBILITY_SEO_IDENTITY_CHANGED",
    })),
    ...held.filter(clearable).map((key): Case => ({
      name: `refuses clearing ${key}`,
      candidate: (f) => void (identity(f)[key] = null),
      code: "COMPATIBILITY_SEO_IDENTITY_CHANGED",
    })),
    ...open.map((key): Case => ({
      name: `accepts adding ${key}`,
      candidate: (f) => void (identity(f)[key] = f.ids.protectedField),
    })),
  ];
}

describe("compatibility: business identity is kept", () => {
  runCases(base, [
    ...identityCases(),
    {
      name: "refuses re-pointing to a field holding the same value",
      candidate: (f) => void (identity(f).legalName = cloneProtectedField(f, f.ids.protectedField)),
      code: "COMPATIBILITY_SEO_IDENTITY_CHANGED",
    },
  ]);
});

function metadataSlotCases(entry: (f: Fixture) => JsonObject, code: string): Case[] {
  const slots = Object.entries(object(entry(base()).metadata)).filter(([, value]) => typeof value === "string");
  return slots.map(([slot]) => ({
    name: `refuses re-pointing metadata.${slot} to a same-valued field`,
    candidate: (f) => {
      const metadata = object(entry(f).metadata);
      metadata[slot] = cloneProtectedField(f, metadata[slot] as string);
    },
    code,
  }));
}

describe("compatibility: page SEO facts are kept", () => {
  const code = "COMPATIBILITY_PAGE_SEO_CHANGED";
  const jsonLd = (f: Fixture): JsonObject => objects(pageSeo(f).jsonLd)[0];
  runCases(base, [
    ...metadataSlotCases(pageSeo, code),
    { name: "refuses dropping the share image", candidate: (f) => void (object(object(pageSeo(f).metadata).social).image = null), code },
    { name: "refuses emptying the heading outline", candidate: (f) => void (pageSeo(f).headingOutline = []), code },
    { name: "accepts reordered required internal links", production: (f) => void (object(pageSeo(f).internalLinks).requiredPageIds = [f.ids.generatedPage, f.ids.homePage]), candidate: (f) => void (object(pageSeo(f).internalLinks).requiredPageIds = [f.ids.homePage, f.ids.generatedPage]) },
    { name: "refuses reordered JSON-LD output properties, a list no reference passes through", production: (f) => void (jsonLd(f).requiredOutputProperties = ["name", "telephone"]), candidate: (f) => void (jsonLd(f).requiredOutputProperties = ["telephone", "name"]), code },
    { name: "refuses a share image field the candidate adds as a new key", candidate: (f) => void (object(object(pageSeo(f).metadata).social).imageFieldId = f.ids.imageField), code },
    { name: "refuses a changed JSON-LD type", candidate: (f) => void (jsonLd(f).schemaType = "Organization"), code },
    { name: "refuses JSON-LD made optional", candidate: (f) => void (jsonLd(f).required = false), code },
    { name: "refuses a dropped JSON-LD declaration", candidate: (f) => void (pageSeo(f).jsonLd = []), code },
    { name: "refuses a re-pointed JSON-LD source", candidate: (f) => void (jsonLd(f).sourceFieldIds = [f.ids.protectedDescriptionField]), code },
    { name: "refuses a re-pointed primary entity", candidate: (f) => void (object(pageSeo(f).intent).primaryEntity = f.ids.protectedDescriptionField), code },
    { name: "refuses a dropped required internal link", candidate: (f) => void (object(pageSeo(f).internalLinks).requiredPageIds = []), code },
    { name: "accepts a JSON-LD source inserted before production's", candidate: (f) => void (jsonLd(f).sourceFieldIds = [f.ids.protectedDescriptionField, f.ids.protectedField]) },
    { name: "accepts a JSON-LD source added", candidate: (f) => void (jsonLd(f).sourceFieldIds = [f.ids.protectedField, f.ids.protectedDescriptionField]) },
    { name: "accepts a JSON-LD output property added", candidate: (f) => void (jsonLd(f).requiredOutputProperties = ["name", "telephone"]) },
    { name: "accepts a second JSON-LD declaration", candidate: (f) => void objects(pageSeo(f).jsonLd).push({ ...structuredClone(jsonLd(f)), schemaType: "Organization" }) },
    { name: "refuses a share title set where production had none", candidate: (f) => void (object(object(pageSeo(f).metadata).social).title = f.ids.protectedField), code },
    { name: "refuses a breadcrumb parent set where production had none", candidate: (f) => void (pageSeo(f).breadcrumbParentPageId = f.ids.generatedPage), code },
    // All Points Media #61 took a hidden 404 route out of the sitemap by code.
    // Sitemap, purpose and budgets are page values outside any reference, so
    // the identity rule leaves them to the site.
    { name: "accepts the All Points Media #61 sitemap and purpose change", candidate: (f) => {
      const entry = pageSeo(f);
      object(entry.intent).purpose = "other";
      entry.sitemap = { included: false, changeFrequency: "never", priority: 0 };
    } },
    { name: "accepts a changed performance budget", candidate: (f) => void (object(pageSeo(f).performanceBudget).maxPageBytes = 2) },
  ]);
});

describe("compatibility: generated page SEO facts are kept", () => {
  const code = "COMPATIBILITY_GENERATED_PAGE_SEO_CHANGED";
  const jsonLd = (f: Fixture): JsonObject => objects(generatedSeo(f).jsonLd)[0];
  runCases(base, [
    ...metadataSlotCases(generatedSeo, code),
    { name: "refuses a dropped JSON-LD item source", candidate: (f) => void (jsonLd(f).itemSourceFieldIds = [f.ids.generatedTitleField]), code },
    { name: "accepts reordered JSON-LD item sources", candidate: (f) => void (jsonLd(f).itemSourceFieldIds = [f.ids.generatedDescriptionField, f.ids.generatedTitleField]) },
    { name: "refuses a share title dropped", candidate: (f) => void (object(object(generatedSeo(f).metadata).social).title = null), code },
    { name: "refuses a share description re-pointed to a same-valued field", candidate: (f) => {
      const social = object(object(generatedSeo(f).metadata).social);
      social.description = cloneProtectedField(f, social.description as string);
    }, code },
    { name: "refuses a dropped share image field", candidate: (f) => void (object(object(generatedSeo(f).metadata).social).imageFieldId = null), code },
    { name: "refuses a dropped breadcrumb parent", candidate: (f) => void (generatedSeo(f).breadcrumbParentPageId = null), code },
    { name: "refuses a dropped primary image", candidate: (f) => void (generatedSeo(f).primaryImageFieldId = null), code },
    { name: "accepts a changed sitemap priority", candidate: (f) => void (object(generatedSeo(f).sitemap).priority = 0.5) },
  ]);
});

type Leaf = { readonly path: readonly (string | number)[]; readonly value: unknown };

function leaves(value: unknown, path: readonly (string | number)[] = []): Leaf[] {
  if (Array.isArray(value)) return value.flatMap((item, index) => leaves(item, [...path, index]));
  if (value !== null && typeof value === "object") {
    return Object.entries(value).flatMap(([key, item]) => leaves(item, [...path, key]));
  }
  return [{ path, value }];
}

function withLeaf(root: unknown, path: readonly (string | number)[], next: unknown): unknown {
  const copy = structuredClone(root);
  let holder = copy as Record<string | number, unknown>;
  for (const step of path.slice(0, -1)) holder = holder[step] as Record<string | number, unknown>;
  holder[path[path.length - 1]] = next;
  return copy;
}

function changed(value: unknown): unknown {
  if (typeof value === "string") return `${value}x`;
  if (typeof value === "number") return value + 1;
  if (typeof value === "boolean") return !value;
  return "filled";
}

function arraysIn(value: unknown, path: readonly (string | number)[] = []): (readonly (string | number)[])[] {
  if (Array.isArray(value)) {
    return [path, ...value.flatMap((item, index) => arraysIn(item, [...path, index]))];
  }
  if (value !== null && typeof value === "object") {
    return Object.entries(value).flatMap(([key, item]) => arraysIn(item, [...path, key]));
  }
  return [];
}

function at(root: unknown, path: readonly (string | number)[]): unknown {
  return path.reduce<unknown>((value, step) => (value as Record<string | number, unknown>)[step], root);
}

/** Each compared section's production entries in the base fixture, with the rules it is compared by. */
function productionEntries(): { readonly label: string; readonly section: string; readonly value: unknown }[] {
  const fixture = base();
  return comparedSeoSections().flatMap((section) => {
    const value = seo(fixture)[section];
    const entries = Array.isArray(value) ? value.map((entry, index) => [`${section}[${index}]`, entry] as const) : [[section, value] as const];
    return entries.map(([label, entry]) => ({ label, section, value: entry }));
  });
}

function pathOf(steps: readonly (string | number)[]): string {
  return steps.reduce<string>((path, step) => (typeof step === "number" ? `${path}[]` : path === "" ? step : `${path}.${step}`), "");
}

function notCompared(steps: readonly (string | number)[]): boolean {
  const path = pathOf(steps);
  return MANAGED_SEO_FACTS_NOT_COMPARED.some((excluded) => path === excluded || path.startsWith(`${excluded}.`));
}

describe("compatibility: every production SEO fact is compared", () => {
  for (const { label, section, value } of productionEntries()) {
    const rules = seoFactRules(section);
    it(`refuses any changed or dropped fact in ${label}`, () => {
      for (const leaf of leaves(value).filter((entry) => entry.value !== null && !notCompared(entry.path))) {
        assert.equal(isPreservedBy(value, withLeaf(value, leaf.path, changed(leaf.value)), rules), false, `${label} ${leaf.path.join(".")}`);
      }
      for (const arrayPath of arraysIn(value).filter((path) => !notCompared(path))) {
        const items = at(value, arrayPath) as unknown[];
        for (const index of items.keys()) {
          const dropped = items.filter((_, other) => other !== index);
          assert.equal(isPreservedBy(value, withLeaf(value, arrayPath, dropped), rules), false, `${label} drop ${arrayPath.join(".")}[${index}]`);
        }
      }
    });

    it(`treats a null in ${label} as ${rules.openNull ? "an open slot" : "a fact"}`, () => {
      for (const leaf of leaves(value).filter((entry) => entry.value === null && !notCompared(entry.path))) {
        assert.equal(isPreservedBy(value, withLeaf(value, leaf.path, "filled"), rules), rules.openNull, `${label} fill ${leaf.path.join(".")}`);
      }
      assert.equal(isPreservedBy(value, { ...object(value), addedKey: "x" }, rules), rules.openNull, `${label} new key`);
    });

    it(`accepts additions to ${label}'s lists, and reorders only where order is not identity`, () => {
      for (const arrayPath of arraysIn(value).filter((path) => !notCompared(path))) {
        const items = at(value, arrayPath) as unknown[];
        const grown = [...items, "added"];
        assert.equal(isPreservedBy(value, withLeaf(value, arrayPath, grown), rules), true, `${label} append ${arrayPath.join(".")}`);
        if (items.length < 2 || new Set(items.map((item) => JSON.stringify(item))).size < 2) continue;
        const free = rules.orderFree.has(pathOf(arrayPath));
        const reversed = withLeaf(value, arrayPath, [...items].reverse());
        assert.equal(isPreservedBy(value, reversed, rules), free, `${label} reorder ${arrayPath.join(".")}`);
      }
    });
  }
});

describe("compatibility: what the SEO rule compares is derived, with named exceptions", () => {
  it("compares every internalSeo section the schema declares, except those another rule owns", () => {
    const owned = new Set<string>(MANAGED_SEO_SECTIONS_WITH_THEIR_OWN_RULE);
    assert.deepEqual(comparedSeoSections(), Object.keys(managedSiteSeoDescriptorSchema.shape).filter((key) => !owned.has(key)));
    assert.deepEqual(comparedSeoSections(), ["businessIdentity", "pages", "generatedPages"]);
  });

  it("names each exception exactly", () => {
    assert.deepEqual([...MANAGED_SEO_SECTIONS_WITH_THEIR_OWN_RULE], ["protectedFields", "redirects"]);
    assert.deepEqual([...MANAGED_SEO_FACTS_NOT_COMPARED], ["intent.purpose", "sitemap", "internalLinks.minimumInboundLinks", "performanceBudget"]);
    assert.deepEqual([...MANAGED_SEO_SECTIONS_WITH_OPEN_SLOTS], ["businessIdentity"]);
    assert.deepEqual([...MANAGED_REDIRECT_FIELDS_WITH_THEIR_OWN_RULE], ["destination", "status"]);
  });

  it("frees the order of exactly the lists a registered reference passes through", () => {
    assert.deepEqual([...orderFreeSeoLists("businessIdentity")], []);
    for (const section of ["pages", "generatedPages"]) {
      const lists = orderFreeSeoLists(section);
      for (const entry of MANAGED_SITE_CONTRACT_OCCURRENCE_REGISTRY.filter((rule) => rule.role === "reference" && rule.path.startsWith(`internalSeo.${section}[].`))) {
        const relative = entry.path.slice(`internalSeo.${section}[].`.length).replace(/\[[^\]]*\]/gu, "[]");
        const parts = relative.split("[]");
        for (let index = 1; index < parts.length; index += 1) assert.ok(lists.has(parts.slice(0, index).join("[]")), `${section} ${relative}`);
      }
      assert.ok(lists.has("headingOutline") && lists.has("jsonLd") && lists.has("intent.services"), section);
      assert.ok(!lists.has("jsonLd[].requiredOutputProperties"), section);
    }
  });
});

function changedRedirects(production: Fixture, candidate: Fixture): unknown {
  const before = parsed(production);
  const after = parsed(candidate);
  return validateManagedSiteContractV1Compatibility(before.contract, before.content, after.contract, after.content)
    .changedRedirects;
}

describe("compatibility: every changed redirect is listed", () => {
  const pageTarget = (pageId: string): JsonObject => ({ kind: "page", pageId });
  interface ListCase {
    readonly name: string;
    readonly production?: Mutation;
    readonly candidate: Mutation;
    readonly expected: (f: Fixture) => unknown;
  }
  const cases: readonly ListCase[] = [
    { name: "lists nothing for an unchanged pair", candidate: () => undefined, expected: () => [] },
    { name: "lists nothing for an added redirect", candidate: (f) => void redirects(f).push(redirect("/older", f.ids.aboutPage)), expected: () => [] },
    {
      name: "lists a retargeted redirect",
      production: aboutIndexed,
      candidate: (f) => void (redirects(f)[0].destination = pageTarget(f.ids.aboutPage)),
      expected: (f) => [{ fromPath: "/old", fromDestination: pageTarget(f.ids.homePage), toDestination: pageTarget(f.ids.aboutPage), fromStatus: 301, toStatus: 301 }],
    },
    {
      name: "lists a status made permanent",
      production: (f) => void (redirects(f)[0].status = 302),
      candidate: (f) => void (redirects(f)[0].status = 308),
      expected: (f) => [{ fromPath: "/old", fromDestination: pageTarget(f.ids.homePage), toDestination: pageTarget(f.ids.homePage), fromStatus: 302, toStatus: 308 }],
    },
    {
      name: "lists an external target moved to a page, with its status",
      production: (f) => { redirects(f)[0].destination = external("https://example.com/old"); redirects(f)[0].status = 307; },
      candidate: (f) => { redirects(f)[0].destination = pageTarget(f.ids.homePage); redirects(f)[0].status = 301; },
      expected: (f) => [{ fromPath: "/old", fromDestination: external("https://example.com/old"), toDestination: pageTarget(f.ids.homePage), fromStatus: 307, toStatus: 301 }],
    },
    {
      name: "lists several changes ordered by path, not by contract order",
      production: (f) => { aboutIndexed(f); redirects(f).unshift(redirect("/zeta", f.ids.homePage), redirect("/alpha", f.ids.homePage)); },
      candidate: (f) => { for (const entry of redirects(f)) entry.destination = pageTarget(f.ids.aboutPage); },
      expected: (f) => ["/alpha", "/old", "/zeta"].map((fromPath) => ({ fromPath, fromDestination: pageTarget(f.ids.homePage), toDestination: pageTarget(f.ids.aboutPage), fromStatus: 301, toStatus: 301 })),
    },
  ];
  for (const testCase of cases) {
    it(testCase.name, () => {
      const production = withAbout();
      testCase.production?.(production);
      const candidate = structuredClone(production) as Fixture;
      testCase.candidate(candidate);
      const listed = changedRedirects(production, candidate);
      assert.deepEqual(listed, testCase.expected(candidate));
      assert.ok(Object.isFrozen(listed));
    });
  }
});

describe("compatibility: a rich-text level 1 heading in the outline", () => {
  const code = "COMPATIBILITY_PAGE_SEO_CHANGED";
  const h1Entry = (f: Fixture): JsonObject => outline(f)[0];
  const h1Value = (f: Fixture): JsonObject => {
    const value = contentValues(f).find((entry) => entry.fieldId === RICH_H1);
    if (value === undefined) throw new Error("Missing rich H1 value");
    return value;
  };
  const h1Block = (f: Fixture): JsonObject => objects(object(h1Value(f).value).content)[0];
  runCases(withRichH1, [
    { name: "accepts an unchanged pair", candidate: () => undefined },
    { name: "accepts a new section heading after it", candidate: addOutlined(2) },
    { name: "refuses it moved below a section heading", candidate: (f) => void outline(f).push(outline(f).shift() as JsonObject), code },
    // Its content still renders a level 1 heading, which only a level 1 outline entry may declare.
    { name: "refuses dropping it from the outline", candidate: (f) => void outline(f).shift(), code: "CONTENT_RICH_TEXT_H1_UNDECLARED" },
    { name: "refuses re-levelling it to 2", candidate: (f) => void (h1Entry(f).semanticLevel = 2), code: "CONTENT_RICH_TEXT_H1_UNDECLARED" },
    { name: "refuses the outline naming another field as the H1 instead", candidate: (f) => void (h1Entry(f).fieldId = f.ids.titleField), code: "CONTENT_RICH_TEXT_H1_UNDECLARED" },
    { name: "refuses it dropped from the outline with its block demoted to 2", candidate: (f) => { outline(f).shift(); object(h1Block(f).attrs).level = 2; }, code: "COMPATIBILITY_CONTENT_CHANGED" },
    { name: "refuses its text changed by code", candidate: (f) => void (objects(h1Block(f).content)[0].text = "Hello"), code: "COMPATIBILITY_CONTENT_CHANGED" },
    { name: "refuses its block demoted to level 2 by code", candidate: (f) => void (object(h1Block(f).attrs).level = 2), code: "CONTENT_RICH_TEXT_H1_MISSING" },
    { name: "refuses its field no longer admitting headings", candidate: (f) => {
      const field = objects(objects(objects(f.contract.pages)[0].sections).at(-1)?.fields)[0];
      object(field.constraints).allowedBlocks = ["paragraph"];
    }, code: "CONTRACT_SEO_FIELD_POLICY" },
  ]);

  it("compares every fact of the outline that holds it", () => {
    const value = pageSeo(withRichH1()).headingOutline;
    const rules = seoFactRules("pages");
    for (const leaf of leaves(value)) {
      assert.equal(isPreservedBy(value, withLeaf(value, leaf.path, changed(leaf.value)), rules, "headingOutline"), false, leaf.path.join("."));
    }
  });
});

function reorderedSeo(production: Fixture, candidate: Fixture): unknown {
  const before = parsed(production);
  const after = parsed(candidate);
  return validateManagedSiteContractV1Compatibility(before.contract, before.content, after.contract, after.content).reorderedSeo;
}

describe("compatibility: reordering a list whose order is not identity is admitted and listed", () => {
  interface ReorderCase {
    readonly name: string;
    readonly production: Mutation;
    readonly candidate: Mutation;
    readonly paths: (f: Fixture) => readonly string[];
  }
  const homeOutline = (f: Fixture) => [`internalSeo.pages[${f.ids.homePage}].headingOutline`];
  const twoSections: Mutation = (f) => { addOutlined(2)(f); addOutlined(2)(f); };
  const swapLastTwo = (items: JsonObject[]): void => void items.push(...items.splice(-2, 1));
  const cases: readonly ReorderCase[] = [
    { name: "two level 2 sections swapped", production: twoSections, candidate: (f) => swapLastTwo(outline(f)), paths: homeOutline },
    { name: "three sections rotated below the H1", production: (f) => { twoSections(f); addOutlined(2)(f); }, candidate: (f) => void outline(f).splice(1, 0, outline(f).pop() as JsonObject), paths: homeOutline },
    { name: "a section moved and a new one added", production: twoSections, candidate: (f) => { swapLastTwo(outline(f)); addOutlined(3)(f); }, paths: homeOutline },
    {
      name: "a generated page's services reordered",
      production: (f) => void (object(generatedSeo(f).intent).services = [f.ids.generatedTitleField, f.ids.generatedDescriptionField]),
      candidate: (f) => void (object(generatedSeo(f).intent).services = [f.ids.generatedDescriptionField, f.ids.generatedTitleField]),
      paths: (f) => [`internalSeo.generatedPages[${f.ids.generatedPage}].intent.services`],
    },
    {
      name: "two JSON-LD declarations swapped",
      production: (f) => void objects(pageSeo(f).jsonLd).push({ ...structuredClone(objects(pageSeo(f).jsonLd)[0]), schemaType: "Organization" }),
      candidate: (f) => swapLastTwo(objects(pageSeo(f).jsonLd)),
      paths: (f) => [`internalSeo.pages[${f.ids.homePage}].jsonLd`],
    },
    { name: "nothing, for an unchanged pair", production: twoSections, candidate: () => undefined, paths: () => [] },
    {
      name: "a section swapped below the H1 in an outline that repeats a section above it",
      production: (f) => {
        const repeated = addHeading(f, 2);
        const other = addHeading(f, 2);
        pageSeo(f).headingOutline = [{ fieldId: repeated, semanticLevel: 2 }, outline(f)[0], { fieldId: repeated, semanticLevel: 2 }, { fieldId: other, semanticLevel: 2 }];
      },
      candidate: (f) => swapLastTwo(outline(f)),
      paths: homeOutline,
    },
    {
      name: "nothing, for an unchanged list holding the same item twice",
      production: (f) => void (object(generatedSeo(f).intent).services = [f.ids.generatedTitleField, f.ids.generatedTitleField]),
      candidate: () => undefined,
      paths: () => [],
    },
    {
      name: "nothing, for two JSON-LD declarations that each gain a source in place",
      production: (f) => {
        const [first] = objects(pageSeo(f).jsonLd);
        objects(pageSeo(f).jsonLd).push({ ...structuredClone(first), sourceFieldIds: [f.ids.protectedDescriptionField] });
      },
      candidate: (f) => {
        const [first, second] = objects(pageSeo(f).jsonLd);
        first.sourceFieldIds = [f.ids.protectedField, f.ids.protectedDescriptionField];
        second.sourceFieldIds = [f.ids.protectedDescriptionField, f.ids.protectedField];
      },
      paths: () => [],
    },
    { name: "nothing, for a section appended", production: twoSections, candidate: addOutlined(2), paths: () => [] },
  ];
  for (const testCase of cases) {
    it(testCase.name, () => {
      const production = base();
      testCase.production(production);
      const candidate = structuredClone(production) as Fixture;
      testCase.candidate(candidate);
      const listed = reorderedSeo(production, candidate) as readonly { readonly path: string }[];
      assert.deepEqual(listed.map((item) => item.path), testCase.paths(candidate));
      assert.ok(Object.isFrozen(listed));
    });
  }

  runCases(base, [
    { name: "refuses a section moved above the H1", production: twoSections, candidate: (f) => void outline(f).unshift(outline(f).pop() as JsonObject), code: "COMPATIBILITY_PAGE_SEO_CHANGED" },
    { name: "refuses the H1 moved between two sections", production: twoSections, candidate: (f) => void outline(f).splice(1, 0, outline(f).shift() as JsonObject), code: "COMPATIBILITY_PAGE_SEO_CHANGED" },
    { name: "still refuses a swap that also drops a section", production: twoSections, candidate: (f) => { swapLastTwo(outline(f)); outline(f).splice(1, 1); }, code: "COMPATIBILITY_PAGE_SEO_CHANGED" },
    { name: "still refuses a swap that also re-levels a section", production: twoSections, candidate: (f) => { swapLastTwo(outline(f)); outline(f)[1].semanticLevel = 3; }, code: "CONTRACT_SEO_FIELD_POLICY" },
  ]);
});

describe("compatibility: a null share-card slot is a fact, not an open slot", () => {
  const code = "COMPATIBILITY_PAGE_SEO_CHANGED";
  const social = (f: Fixture, pageId?: string): JsonObject => object(object(pageSeo(f, pageId).metadata).social);
  /** A protected field holding words the page never published, named from the share card. */
  const cheapPills = (f: Fixture, from: string): string => {
    const id = cloneProtectedField(f, from);
    const value = contentValues(f).find((entry) => entry.fieldId === id);
    if (value !== undefined) value.value = "CHEAP PILLS";
    return id;
  };
  runCases(base, [
    { name: "refuses a share title filled with new words", candidate: (f) => void (social(f).title = cheapPills(f, f.ids.protectedField)), code },
    { name: "refuses a share title filled with the page's own title field", candidate: (f) => void (social(f).title = f.ids.protectedField), code },
    { name: "refuses a share description filled", candidate: (f) => void (social(f).description = f.ids.protectedDescriptionField), code },
    { name: "refuses a share image filled where production had none", production: (f) => void (social(f).image = null), candidate: (f) => void (social(f).image = f.ids.asset), code },
    { name: "refuses a share image cleared", candidate: (f) => void (social(f).image = null), code },
  ]);
});

describe("compatibility: a static page keeps its H1", () => {
  const code = "COMPATIBILITY_PAGE_SEO_CHANGED";
  runCases(base, [
    { name: "refuses a second H1 appended", candidate: addOutlined(1), code: "CONTRACT_SEO_FIELD_POLICY" },
    { name: "refuses a second H1 ahead of production's", candidate: (f) => { addOutlined(1)(f); outline(f).unshift(outline(f).pop() as JsonObject); }, code: "CONTRACT_SEO_FIELD_POLICY" },
    { name: "refuses the H1 replaced by another heading", candidate: (f) => {
      const id = addHeading(f, 1);
      outline(f)[0] = { fieldId: id, semanticLevel: 1 };
    }, code },
    { name: "refuses the H1 dropped and a level 2 heading kept", production: addOutlined(2), candidate: (f) => void outline(f).shift(), code },
  ]);
  runCases(withAbout, [
    { name: "accepts a section heading added to a page with no H1", candidate: addOutlined(2, undefined) },
    // Admitted and listed: a page with no H1 field may declare its H1 (see "H1 adoption").
    { name: "accepts an H1 added to a page that had none", candidate: (f) => addOutlined(1, f.ids.aboutPage)(f) },
    { name: "refuses an outline naming a heading another page renders", candidate: (f) => {
      const id = addHeading(f, 2, f.ids.aboutPage);
      outline(f).push({ fieldId: id, semanticLevel: 2 });
    }, code: "CONTRACT_SEO_FIELD_POLICY" },
    { name: "refuses an outline naming a plain-text field", candidate: (f) => void outline(f).push({ fieldId: f.ids.bodyField, semanticLevel: 2 }), code: "CONTRACT_SEO_FIELD_POLICY" },
    { name: "refuses an outline naming a protected field", candidate: (f) => void outline(f).push({ fieldId: f.ids.protectedTitle, semanticLevel: 2 }), code: "CONTRACT_SEO_FIELD_POLICY" },
  ]);
});

interface RichHeading {
  readonly level: number;
  readonly outlinedAt: number | null;
  readonly scope?: "page" | "site";
}

/** Declares a rich-text field holding one heading block at `level` on the home page. */
function addRichHeading({ level, outlinedAt, scope = "page" }: RichHeading): Mutation {
  return (f) => {
    const id = fixtureId("field");
    objects(page(f, f.ids.homePage).sections).push({
      id: fixtureId("section"),
      presentation: { name: "Rich heading", description: null, group: "Hero", order: 50, example: null },
      fields: [{
        id,
        scope,
        type: "rich_text",
        classification: "customer_editable",
        capabilities: ["text.edit"],
        resolver: { kind: "json_pointer", path: "content/site.json", pointer: `/rich/${id}` },
        usages: [{ pageId: f.ids.homePage, itemId: null }],
        presentation: { name: "Rich heading", description: null, group: "Hero", order: 1, example: null },
        constraints: {
          maxCharacters: 200, maxNodes: 20, maxBlocks: 1, allowedBlocks: ["heading"], allowedMarks: [],
          allowLinks: false, allowedExternalHosts: [], allowedTargets: [],
        },
      }],
    });
    contentValues(f).push({
      fieldId: id,
      owner: scope === "site" ? { kind: "site" } : { kind: "page", pageId: f.ids.homePage },
      type: "rich_text",
      value: { type: "doc", content: [{ type: "heading", attrs: { level }, content: [{ type: "text", text: `Level ${level}` }] }] },
    });
    if (outlinedAt !== null) outline(f).push({ fieldId: id, semanticLevel: outlinedAt });
  };
}

describe("compatibility: a page's H1 is read from what it renders", () => {
  const code = "COMPATIBILITY_PAGE_SEO_CHANGED";
  const undeclared = "CONTENT_RICH_TEXT_H1_UNDECLARED";
  /** All Points Media's shape: one visible H1 set on two heading fields, neither outlined. */
  const twoLineHeadline: Mutation = (f) => void addHeading(f, 1);
  runCases(base, [
    { name: "refuses a level 1 heading field added outside the outline", candidate: (f) => void addHeading(f, 1), code },
    { name: "refuses a level 1 heading field added inside the outline", candidate: addOutlined(1), code: "CONTRACT_SEO_FIELD_POLICY" },
    { name: "refuses a rich-text level 1 heading outlined at 2", candidate: addRichHeading({ level: 1, outlinedAt: 2 }), code: undeclared },
    { name: "refuses a rich-text level 1 heading left out of the outline", candidate: addRichHeading({ level: 1, outlinedAt: null }), code: undeclared },
    { name: "refuses a site-owned rich-text level 1 heading rendered on the page", candidate: addRichHeading({ level: 1, outlinedAt: null, scope: "site" }), code: undeclared },
    { name: "refuses a rich-text level 1 heading outlined at 1 beside production's H1", candidate: addRichHeading({ level: 1, outlinedAt: 1 }), code: "CONTRACT_SEO_FIELD_POLICY" },
    { name: "refuses the H1 heading field demoted to 2", candidate: (f) => {
      const title = objects(objects(page(f, f.ids.homePage).sections)[0].fields).find((field) => field.type === "heading_text") as JsonObject;
      title.semanticLevel = 2;
      outline(f)[0].semanticLevel = 2;
    }, code: "COMPATIBILITY_FIELD_POLICY_NARROWED" },
    { name: "refuses a third line added to a two-line headline", production: twoLineHeadline, candidate: (f) => void addHeading(f, 1), code },
    { name: "accepts an unchanged two-line headline", production: twoLineHeadline, candidate: () => undefined },
    { name: "accepts a rich-text level 2 heading outlined at 2", candidate: addRichHeading({ level: 2, outlinedAt: 2 }) },
    { name: "accepts a rich-text level 3 heading left out of the outline", candidate: addRichHeading({ level: 3, outlinedAt: null }) },
    { name: "accepts a level 2 heading field added outside the outline", candidate: (f) => void addHeading(f, 2) },
  ]);

});

/** A paragraph-only rich-text field on the home page, optionally outlined. */
function addParagraphField(outlinedAt: number | null): Mutation {
  return (f) => {
    addRichHeading({ level: 2, outlinedAt: null })(f);
    const section = objects(page(f, f.ids.homePage).sections).at(-1) as JsonObject;
    const field = objects(section.fields)[0];
    object(field.constraints).allowedBlocks = ["paragraph"];
    const value = contentValues(f).find((entry) => entry.fieldId === field.id) as JsonObject;
    value.value = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "A hero line" }] }] };
    if (outlinedAt !== null) outline(f).push({ fieldId: field.id, semanticLevel: outlinedAt });
  };
}

describe("contract semantics: an outline entry names a field that can render that heading", () => {
  const code = "CONTRACT_SEO_FIELD_POLICY";
  runCases(base, [
    { name: "refuses a paragraph-only rich-text field outlined at 2", candidate: addParagraphField(2), code },
    { name: "refuses a paragraph-only rich-text field outlined at 3", candidate: addParagraphField(3), code },
    { name: "refuses a paragraph-only rich-text field declared as the H1", candidate: (f) => { pageSeo(f).headingOutline = []; addParagraphField(1)(f); }, code },
    { name: "refuses a heading-capable rich-text field outlined at 4", candidate: addRichHeading({ level: 2, outlinedAt: 4 }), code },
    { name: "accepts a paragraph-only rich-text field left out of the outline", candidate: addParagraphField(null) },
    { name: "accepts a heading-capable rich-text field outlined at 3 holding a level 3 heading", candidate: addRichHeading({ level: 3, outlinedAt: 3 }) },
  ]);
});

function adoptedH1(production: Fixture, candidate: Fixture): unknown {
  const before = parsed(production);
  const after = parsed(candidate);
  return validateManagedSiteContractV1Compatibility(before.contract, before.content, after.contract, after.content).adoptedH1;
}

/** A rich-text level 1 heading on the about page, outlined there at level 1 or not at all. */
function aboutRichH1(outlined: boolean): Mutation {
  return (f) => {
    const id = fixtureId("field");
    objects(page(f, f.ids.aboutPage).sections).push({
      id: fixtureId("section"),
      presentation: { name: "Hero", description: null, group: "Hero", order: 0, example: null },
      fields: [{
        id, scope: "page", type: "rich_text", classification: "customer_editable", capabilities: ["text.edit"],
        resolver: { kind: "json_pointer", path: "content/site.json", pointer: `/about/${id}` },
        usages: [{ pageId: f.ids.aboutPage, itemId: null }],
        presentation: { name: "Headline", description: null, group: "Hero", order: 1, example: null },
        constraints: { maxCharacters: 200, maxNodes: 20, maxBlocks: 1, allowedBlocks: ["heading"], allowedMarks: [], allowLinks: false, allowedExternalHosts: [], allowedTargets: [] },
      }],
    });
    contentValues(f).push({ fieldId: id, owner: { kind: "page", pageId: f.ids.aboutPage }, type: "rich_text", value: { type: "doc", content: [{ type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "About us" }] }] } });
    if (outlined) outline(f, f.ids.aboutPage).push({ fieldId: id, semanticLevel: 1 });
  };
}

describe("compatibility: a page with no H1 may declare its H1, which is listed", () => {
  interface AdoptionCase {
    readonly name: string;
    readonly production?: Mutation;
    readonly candidate: Mutation;
    readonly fields: number;
  }
  const cases: readonly AdoptionCase[] = [
    { name: "one heading field, outside the outline", candidate: (f) => void addHeading(f, 1, f.ids.aboutPage), fields: 1 },
    { name: "one heading field, named by the outline", candidate: (f) => addOutlined(1, f.ids.aboutPage)(f), fields: 1 },
    { name: "a headline set on two heading fields", candidate: (f) => { addHeading(f, 1, f.ids.aboutPage); addHeading(f, 1, f.ids.aboutPage); }, fields: 2 },
    { name: "a rich-text headline its outline declares at level 1", candidate: aboutRichH1(true), fields: 1 },
    { name: "an outlined H1 placed before the sections production had", production: (f) => addOutlined(2, f.ids.aboutPage)(f), candidate: (f) => {
      const id = addHeading(f, 1, f.ids.aboutPage);
      outline(f, f.ids.aboutPage).unshift({ fieldId: id, semanticLevel: 1 });
    }, fields: 1 },
  ];
  for (const testCase of cases) {
    it(`admits and lists ${testCase.name}`, () => {
      const production = withAbout();
      testCase.production?.(production);
      const candidate = structuredClone(production) as Fixture;
      testCase.candidate(candidate);
      const listed = adoptedH1(production, candidate) as readonly { readonly pageId: string; readonly fieldIds: readonly string[] }[];
      assert.equal(listed.length, 1);
      assert.equal(listed[0]?.pageId, candidate.ids.aboutPage);
      assert.equal(listed[0]?.fieldIds.length, testCase.fields);
      assert.deepEqual(listed[0]?.fieldIds, [...(listed[0]?.fieldIds ?? [])].sort());
      assert.ok(Object.isFrozen(listed) && Object.isFrozen(listed[0]));
    });
  }

  it("lists nothing for an unchanged pair", () => {
    const production = withAbout();
    assert.deepEqual(adoptedH1(production, structuredClone(production) as Fixture), []);
  });

  const code = "COMPATIBILITY_PAGE_SEO_CHANGED";
  runCases(withAbout, [
    { name: "refuses a rich-text level 1 heading the outline does not declare", candidate: aboutRichH1(false), code: "CONTENT_RICH_TEXT_H1_UNDECLARED" },
    { name: "refuses a second H1 on a page that has one", candidate: (f) => void addHeading(f, 1), code },
    { name: "refuses a third line on a headline adopted earlier", production: (f) => { addHeading(f, 1, f.ids.aboutPage); addHeading(f, 1, f.ids.aboutPage); }, candidate: (f) => void addHeading(f, 1, f.ids.aboutPage), code },
    { name: "refuses two H1 outline entries adopted at once", candidate: (f) => { addOutlined(1, f.ids.aboutPage)(f); addOutlined(1, f.ids.aboutPage)(f); }, code: "CONTRACT_SEO_FIELD_POLICY" },
    { name: "refuses an outlined H1 adopted below a section production had", production: (f) => addOutlined(2, f.ids.aboutPage)(f), candidate: (f) => addOutlined(1, f.ids.aboutPage)(f), code },
    { name: "refuses an outlined H1 adopted between two sections", production: (f) => { addOutlined(2, f.ids.aboutPage)(f); addOutlined(2, f.ids.aboutPage)(f); }, candidate: (f) => {
      const id = addHeading(f, 1, f.ids.aboutPage);
      outline(f, f.ids.aboutPage).splice(1, 0, { fieldId: id, semanticLevel: 1 });
    }, code },
    { name: "refuses an adoption that also drops a section", production: (f) => addOutlined(2, f.ids.aboutPage)(f), candidate: (f) => { outline(f, f.ids.aboutPage).splice(0, 1); addOutlined(1, f.ids.aboutPage)(f); }, code },
  ]);
});

function collectionOf(f: Fixture): JsonObject {
  return objects(f.contract.collections)[0] as JsonObject;
}

/** A second level 1 heading item field, valued for every item. */
const itemHeadingAdded: Mutation = (f) => {
  const fields = objects(collectionOf(f).itemFields);
  const original = fields.find((field) => field.id === f.ids.itemHeadingField) as JsonObject;
  const id = fixtureId("field");
  fields.push({ ...structuredClone(original), id, itemPointer: "/h2" });
  for (const value of contentValues(f).filter((entry) => entry.fieldId === f.ids.itemHeadingField)) {
    contentValues(f).push({ ...structuredClone(value), fieldId: id });
  }
};

/** The item rich-text field admitting headings and holding one at `level`. */
function itemRichHeading(level: number): Mutation {
  return (f) => {
    const field = objects(collectionOf(f).itemFields).find((entry) => entry.id === f.ids.itemRichField) as JsonObject;
    object(field.constraints).allowedBlocks = ["paragraph", "heading"];
    const value = contentValues(f).find((entry) => entry.fieldId === f.ids.itemRichField) as JsonObject;
    value.value = { type: "doc", content: [{ type: "heading", attrs: { level }, content: [{ type: "text", text: "Item heading" }] }] };
  };
}

/** The site rich-text field, used only on the generated page's item, holding a heading at `level`. */
function siteRichHeadingOnGeneratedPage(level: number): Mutation {
  return (f) => {
    const field = objects(objects(page(f, f.ids.homePage).sections)[0].fields).find((entry) => entry.id === f.ids.richField) as JsonObject;
    object(field.constraints).allowedBlocks = ["paragraph", "heading"];
    field.usages = objects(field.usages).filter((usage) => usage.itemId !== null);
    const value = contentValues(f).find((entry) => entry.fieldId === f.ids.richField) as JsonObject;
    value.value = { type: "doc", content: [{ type: "heading", attrs: { level }, content: [{ type: "text", text: "Site heading" }] }] };
  };
}

describe("compatibility: a page's H1 is read from every field it renders, on static and generated pages", () => {
  const code = "COMPATIBILITY_PAGE_SEO_CHANGED";
  const undeclared = "CONTENT_RICH_TEXT_H1_UNDECLARED";
  runCases(base, [
    { name: "refuses a level 1 heading item field added to a collection the pages render", candidate: itemHeadingAdded, code },

    { name: "refuses a level 1 heading field added to the generated page's own sections", candidate: (f) => {
      const id = addHeading(f, 1);
      const field = objects(objects(page(f, f.ids.homePage).sections)[0].fields).find((entry) => entry.id === id) as JsonObject;
      field.scope = "site";
      field.usages = [{ pageId: f.ids.generatedPage, itemId: f.ids.item }];
      const value = contentValues(f).find((entry) => entry.fieldId === id) as JsonObject;
      value.owner = { kind: "site" };
    }, code },
  ]);
});

/** A fixture's verdict under content semantics alone: what a CMS edit is held to. */
function contentVerdict(fixture: Fixture): string {
  try {
    validateManagedSiteContractV1ContentSemantics(parseManagedSiteContractV1(fixture.contract), parseManagedSiteContentDocument(fixture.content));
    return ACCEPTED;
  } catch (error) {
    if (error instanceof ManagedSiteContractError) return error.code;
    throw error;
  }
}

describe("content semantics: a level 1 rich-text heading renders only where the outline declares it", () => {
  const undeclared = "CONTENT_RICH_TEXT_H1_UNDECLARED";
  const cases: readonly [string, () => Fixture, Mutation, string][] = [
    ["an item rich-text field rendered on a listing and its generated page", base, itemRichHeading(1), undeclared],
    ["a site rich-text field used only on the generated page", base, siteRichHeadingOnGeneratedPage(1), undeclared],
    ["a rich-text field on a static page, outlined at 2", base, addRichHeading({ level: 1, outlinedAt: 2 }), undeclared],
    ["an item rich-text field holding a level 2 heading", base, itemRichHeading(2), ACCEPTED],
    ["a site rich-text field on the generated page holding a level 2 heading", base, siteRichHeadingOnGeneratedPage(2), ACCEPTED],
    ["the outlined rich-text H1", withRichH1, () => undefined, ACCEPTED],
  ];
  for (const [name, make, mutate, expected] of cases) {
    it(`${expected === ACCEPTED ? "accepts" : "refuses"} ${name}`, () => {
      const fixture = make();
      mutate(fixture);
      assert.equal(contentVerdict(fixture), expected);
    });
  }
});

describe("content semantics: an outlined rich-text H1 must render a level 1 heading", () => {
  const missing = "CONTENT_RICH_TEXT_H1_MISSING";
  const withAboutRichH2Outlined: Mutation = (f) => {
    aboutRichH1(true)(f);
    const value = contentValues(f).at(-1) as JsonObject;
    value.value = { type: "doc", content: [{ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "About us" }] }] };
  };
  const h1Value = (f: Fixture): JsonObject => contentValues(f).find((entry) => entry.fieldId === RICH_H1) as JsonObject;
  runCases(withAbout, [
    { name: "refuses adopting, as the H1, a rich-text field holding only a level 2 heading", candidate: withAboutRichH2Outlined, code: missing },
  ]);
  runCases(withRichH1, [
    { name: "refuses an edit that replaces the H1 block with a paragraph", candidate: (f) => {
      const field = objects(objects(objects(f.contract.pages)[0].sections).find((section) => section.id === RICH_H1_SECTION)?.fields)[0];
      object(field.constraints).allowedBlocks = ["heading", "paragraph"];
      h1Value(f).value = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Welcome" }] }] };
    }, code: missing },
    { name: "refuses an edit that demotes the H1 block to level 3", candidate: (f) => void (objects(object(h1Value(f).value).content)[0].attrs = { level: 3 }), code: missing },
  ]);
});

describe("managedRenderedH1Sources: the one reading of a page's H1, for the policy and a CMS", () => {
  it("reads a generated page's item heading from its own collection, not only from its outline", () => {
    const fixture = base();
    const contract = parseManagedSiteContractV1(fixture.contract);
    const content = parseManagedSiteContentDocument(fixture.content);
    const generated = managedRenderedH1Sources(contract, content, fixture.ids.generatedPage);
    assert.ok(generated.headingFields.includes(fixture.ids.itemHeadingField));
    const home = managedRenderedH1Sources(contract, content, fixture.ids.homePage);
    assert.ok(home.headingFields.includes(fixture.ids.itemHeadingField), "the home page lists the collection");
    assert.deepEqual([...managedPageH1Fields(contract, content, fixture.ids.homePage)].sort(), [fixture.ids.itemHeadingField, fixture.ids.titleField].sort());
  });
});

describe("content semantics: an outlined rich-text H1 renders exactly one level 1 heading", () => {
  const heading = (level: number, text: string): JsonObject => ({ type: "heading", attrs: { level }, content: [{ type: "text", text }] });
  /** The rich-text H1 with no block bound, holding `blocks`. */
  const holding = (blocks: readonly JsonObject[]): Mutation => (f) => {
    const section = objects(objects(f.contract.pages)[0].sections).find((entry) => entry.id === RICH_H1_SECTION) as JsonObject;
    const constraints = object(objects(section.fields)[0].constraints);
    delete constraints.maxBlocks;
    constraints.allowedBlocks = ["heading", "paragraph", "bullet_list"];
    (contentValues(f).find((entry) => entry.fieldId === RICH_H1) as JsonObject).value = { type: "doc", content: blocks };
  };
  const cases: readonly [string, () => Fixture, Mutation, string][] = [
    ["no level 1 block, one level 2", withRichH1, holding([heading(2, "a")]), "CONTENT_RICH_TEXT_H1_MISSING"],
    ["one level 1 block", withRichH1, holding([heading(1, "a")]), ACCEPTED],
    ["one level 1 block and a level 2 below it", withRichH1, holding([heading(1, "a"), heading(2, "b")]), ACCEPTED],
    ["two level 1 blocks", withRichH1, holding([heading(1, "a"), heading(1, "b")]), "CONTENT_RICH_TEXT_H1_REPEATED"],
    ["two level 1 blocks around a paragraph", withRichH1, holding([heading(1, "a"), { type: "paragraph", content: [{ type: "text", text: "x" }] }, heading(1, "b")]), "CONTENT_RICH_TEXT_H1_REPEATED"],
    ["three level 1 blocks", withRichH1, holding([heading(1, "a"), heading(1, "b"), heading(1, "c")]), "CONTENT_RICH_TEXT_H1_REPEATED"],
    ["two level 2 blocks in an unoutlined field (control)", base, addRichHeading({ level: 2, outlinedAt: null }), ACCEPTED],
  ];
  for (const [name, make, mutate, expected] of cases) {
    it(`${expected === ACCEPTED ? "accepts" : "refuses"} ${name}`, () => {
      const fixture = make();
      mutate(fixture);
      assert.equal(contentVerdict(fixture), expected);
    });
  }

  it("cannot hold a level 1 heading nested in a list: the grammar admits headings at the top level only", () => {
    const fixture = withRichH1();
    holding([{ type: "bullet_list", content: [{ type: "list_item", content: [heading(1, "a")] }] }, heading(1, "b")])(fixture);
    assert.throws(() => parseManagedSiteContentDocument(fixture.content));
  });
});
