import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { type TestContext } from "node:test";

import { createManagedSiteNextV1 } from "@landing-pages-websites/managed-site-contract";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";

import { ADVERSARIAL_DOCUMENTS, ADVERSARIAL_LINKS, external, internalTo, linkValue } from "./support/reader-cases.js";
import {
  IDS,
  RICH_TEXT_DOCUMENT,
  homeDocument,
  loadRuntime,
  runtimeSite,
  type JsonObject,
  type GeneratedRuntime,
  type RuntimeSite,
} from "./support/runtime-site.js";

/**
 * THE INVARIANT: whatever the contract package accepts, a reader renders.
 *
 * A reader stricter than the contract fails a site's build on content the CMS
 * saved and Site Guard passed, which leaves the publish stuck with editing
 * fenced. So each case here is judged twice: by the contract, as Site Guard
 * judges it -- the whole site, with the value in a field of the case's policy,
 * projected by createManagedSiteNextV1, the same call a converted site's build
 * makes -- and by the reader on the bare value. Accepted must mean rendered.
 * Refused MAY throw (the reader judges a bare value, which has no field policy
 * to be stricter with), and the tally of each is reported.
 *
 * The cases are the contract package's own shared tables (the ones megaseo-web's
 * CMS is held to), every hand-written adversarial input the behavioural suite
 * has, and image and search-text values around each slot and field rule.
 */

const CONTRACT_TESTS = new URL("../../managed-site-contract/test/", import.meta.url);

interface Expected {
  readonly outcome: "accepted" | "rejected";
}
interface LinkTable {
  readonly pageId: string;
  readonly bases: Readonly<Record<string, JsonObject>>;
  readonly destinationCases: readonly {
    readonly name: string;
    readonly base: string;
    readonly constraints?: JsonObject;
    readonly destination: unknown;
    readonly expected: Expected;
  }[];
  readonly labelCases: readonly {
    readonly name: string;
    readonly label: string;
    readonly newlines: string;
    readonly expected: Expected;
  }[];
}
interface GrammarTable {
  readonly baseConstraints: JsonObject;
  readonly cases: readonly {
    readonly name: string;
    readonly constraints?: JsonObject;
    readonly document: unknown;
    readonly expected: Expected;
  }[];
}

function table<Shape>(name: string): Shape {
  return JSON.parse(readFileSync(new URL(name, CONTRACT_TESTS), "utf8")) as Shape;
}

const LINKS = table<LinkTable>("cms-link-rule-cases.json");
const GRAMMAR = table<GrammarTable>("rich-text-block-grammar-cases.json");

/** The tables name one page; ours is /about. Anything else is left as written. */
function onOurPage<Value>(value: Value): Value {
  return JSON.parse(JSON.stringify(value).split(`"${LINKS.pageId}"`).join(`"${IDS.aboutPage}"`)) as Value;
}

const html = (node: unknown): string => renderToStaticMarkup(node as ReactElement);
const runtime = await loadRuntime(runtimeSite());

function renders(render: () => unknown): boolean {
  try {
    render();
    return true;
  } catch {
    return false;
  }
}

/** The contract's verdict on a whole site, exactly as a build reaches it. */
function contractAccepts(site: RuntimeSite): boolean {
  return renders(() =>
    createManagedSiteNextV1({
      contract: site.contract,
      sourceDocuments: [...site.documents].map(([path, value]) => ({ path, value })),
    }),
  );
}

function renderedField(site: RuntimeSite, fieldId: string): JsonObject {
  for (const page of site.contract.pages as JsonObject[]) {
    for (const section of page.sections as JsonObject[]) {
      const field = (section.fields as JsonObject[]).find((candidate) => candidate.id === fieldId);
      if (field !== undefined) return field;
    }
  }
  throw new Error(`no field ${fieldId}`);
}

const LINK_OPEN: JsonObject = { ...LINKS.bases.link_open, allowedFragments: ["team", "method", "pricing"] };
const RICH_OPEN = {
  ...GRAMMAR.baseConstraints,
  allowedMarks: ["bold", "italic"],
  externalHostPolicy: "any_https",
  allowedExternalHosts: [],
  allowedTargets: ["same_window", "new_window"],
};

/** The site with one link value in a link field of the given policy. */
function siteWithLink(constraints: JsonObject, value: unknown): RuntimeSite {
  const site = runtimeSite();
  renderedField(site, IDS.externalLink).constraints = constraints;
  (homeDocument(site).links as JsonObject).external = value;
  return site;
}

function holdsLevelOneHeading(document: unknown): boolean {
  const blocks = (document as { readonly content?: unknown }).content;
  return Array.isArray(blocks) && blocks.some((block: JsonObject) =>
    block?.type === "heading" && (block.attrs as JsonObject | undefined)?.level === 1);
}

/**
 * Makes the body the home page's declared H1. Since 0.16.0 a level 1 rich-text
 * heading renders only in a field the page's outline names at level 1
 * (CONTENT_RICH_TEXT_H1_UNDECLARED), so a level 1 case is judged where it is
 * the page's one H1 rather than a second one.
 */
function declareBodyAsH1(site: RuntimeSite): void {
  const seo = site.contract.internalSeo as JsonObject;
  const home = (seo.pages as JsonObject[]).find((entry) => entry.pageId === IDS.homePage);
  if (home === undefined) throw new Error("The runtime site has no home page SEO entry");
  home.headingOutline = [
    { fieldId: IDS.body, semanticLevel: 1 },
    ...(home.headingOutline as JsonObject[]).filter((heading) => heading.semanticLevel !== 1),
  ];
}

/** The site with one document in a rich-text field of the given policy. */
function siteWithDocument(constraints: JsonObject, document: unknown): RuntimeSite {
  const site = runtimeSite();
  const field = renderedField(site, IDS.body);
  const marks = (constraints.allowedMarks as string[]).map((mark) => `rich_text.mark.${mark}`);
  field.capabilities = ["text.edit", ...marks, ...(constraints.allowLinks === true ? ["rich_text.link.edit"] : [])];
  field.constraints = constraints;
  homeDocument(site).body = document;
  if (holdsLevelOneHeading(document)) declareBodyAsH1(site);
  return site;
}

interface Tally {
  acceptedRendered: number;
  refusedThrew: number;
  refusedRendered: number;
  disagreements: string[];
}

function newTally(): Tally {
  return { acceptedRendered: 0, refusedThrew: 0, refusedRendered: 0, disagreements: [] };
}

type Outcome = "accepted" | "rejected";

function attempt(render: () => unknown): { readonly ok: true; readonly value: unknown } | { readonly ok: false } {
  try {
    return { ok: true, value: render() };
  } catch {
    return { ok: false };
  }
}

/**
 * One case, judged by the contract and by the reader twice: on the bare value,
 * and through the site the way a real page reads it (managedLink(fieldId) and
 * friends, over site.readValue), which must agree with the bare read.
 */
async function judge(
  tally: Tally,
  name: string,
  site: RuntimeSite,
  expected: Outcome,
  bare: () => unknown,
  viaSite: (loaded: GeneratedRuntime) => unknown,
): Promise<void> {
  const accepted = contractAccepts(site);
  if ((expected === "accepted") !== accepted) tally.disagreements.push(`${name}: expected ${expected}`);
  const direct = attempt(bare);
  if (!accepted) {
    if (direct.ok) tally.refusedRendered += 1;
    else tally.refusedThrew += 1;
    return;
  }
  assert.equal(direct.ok, true, `the contract accepts, so the reader must render: ${name}`);
  const loaded = await loadRuntime(site);
  const read = attempt(() => viaSite(loaded));
  assert.equal(read.ok, true, `the contract accepts, so the site's own read must render: ${name}`);
  assert.deepEqual(read.ok ? read.value : null, direct.ok ? direct.value : null, `the site's read is the bare read: ${name}`);
  tally.acceptedRendered += 1;
}

function report(t: TestContext, what: string, tally: Tally): void {
  t.diagnostic(
    `${what}: accepted+rendered ${String(tally.acceptedRendered)}, refused+threw ${String(tally.refusedThrew)}, ` +
      `refused+rendered ${String(tally.refusedRendered)}`,
  );
  assert.deepEqual(tally.disagreements, [], "every case's stated verdict is the contract's");
}

const anchor = (link: unknown): unknown => {
  const { href, label, target, rel } = link as JsonObject;
  return { href, label, target, rel };
};

function judgeLink(tally: Tally, name: string, constraints: JsonObject, value: unknown, expected: Outcome): Promise<void> {
  return judge(
    tally,
    name,
    siteWithLink(constraints, value),
    expected,
    () => anchor(runtime.resolveManagedLink(value)),
    (loaded) => anchor(loaded.managedLink(IDS.externalLink)),
  );
}

function judgeDocument(tally: Tally, name: string, constraints: JsonObject, document: unknown, expected: Outcome): Promise<void> {
  return judge(
    tally,
    name,
    siteWithDocument(constraints, document),
    expected,
    () => html(runtime.renderManagedRichText(document)),
    (loaded) => html(loaded.managedRichTextBlocks(IDS.body).value),
  );
}

test("links: contract accepts => reader renders", async (t) => {
  const tally = newTally();
  for (const entry of LINKS.destinationCases) {
    const destination = onOurPage(entry.destination);
    const constraints = onOurPage({ ...LINKS.bases[entry.base], ...entry.constraints });
    const name = `table: ${entry.name}`;
    if (entry.base.startsWith("rich")) {
      const document = {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Read more", marks: [{ type: "link", destination, target: "same_window" }] }] }],
      };
      await judgeDocument(tally, name, constraints, document, entry.expected.outcome);
    } else {
      const value = { label: "Read more", destination, target: "same_window" };
      await judgeLink(tally, name, constraints, value, entry.expected.outcome);
    }
  }
  for (const entry of LINKS.labelCases) {
    const constraints = { ...LINK_OPEN, labelConstraints: { ...(LINK_OPEN.labelConstraints as JsonObject), newlines: entry.newlines } };
    const value = { label: entry.label, destination: external("https://example.org/"), target: "same_window" };
    await judgeLink(tally, `label: ${entry.name}`, constraints, value, entry.expected.outcome);
  }
  for (const [name, value, expected] of ADVERSARIAL_LINKS) {
    await judgeLink(tally, `adversarial: ${name}`, LINK_OPEN, value, expected);
  }
  report(t, "links", tally);
});

test("rich text: contract accepts => reader renders", async (t) => {
  const tally = newTally();
  for (const entry of GRAMMAR.cases) {
    const document = onOurPage(entry.document);
    const constraints = { ...GRAMMAR.baseConstraints, ...entry.constraints };
    await judgeDocument(tally, `table: ${entry.name}`, constraints, document, entry.expected.outcome);
  }
  const documents: readonly [string, unknown, Outcome][] = [
    ["the full-grammar fixture", RICH_TEXT_DOCUMENT, "accepted"],
    ...ADVERSARIAL_DOCUMENTS,
  ];
  for (const [name, document, expected] of documents) {
    await judgeDocument(tally, `adversarial: ${name}`, RICH_OPEN, document, expected);
  }
  report(t, "rich text", tally);
});

function imageValue(overrides: JsonObject): JsonObject {
  return {
    path: "public/managed-site-cms/case.png",
    sha256: "a".repeat(64),
    mimeType: "image/png",
    width: 1200,
    height: 600,
    bytes: 4096,
    altText: "Alt",
    crop: null,
    focalPoint: null,
    ...overrides,
  };
}

/** [name, slot, pointer in home.json, value, the contract's verdict]: each slot rule, one at a time. */
const IMAGE_CASES: readonly [string, string, string, JsonObject, Outcome][] = [
  ["fixed_alt, null alt", IDS.fixedSlot, "fixed", imageValue({ altText: null }), "accepted"],
  ["fixed_alt, own alt", IDS.fixedSlot, "fixed", imageValue({ altText: "mine" }), "rejected"],
  ["fixed_alt, empty alt", IDS.fixedSlot, "fixed", imageValue({ altText: "" }), "rejected"],
  ["decorative, empty alt", IDS.decorativeSlot, "decorative", imageValue({ altText: "" }), "accepted"],
  ["decorative, alt text", IDS.decorativeSlot, "decorative", imageValue({ altText: "x" }), "rejected"],
  ["decorative, null alt", IDS.decorativeSlot, "decorative", imageValue({ altText: null }), "rejected"],
  ["informative, markup alt", IDS.shareSlot, "share", imageValue({ altText: "<script>alert(1)</script>" }), "accepted"],
  ["informative, blank alt", IDS.shareSlot, "share", imageValue({ altText: "  " }), "rejected"],
  ["informative, null alt", IDS.shareSlot, "share", imageValue({ altText: null }), "rejected"],
  ["outside public/", IDS.shareSlot, "share", imageValue({ path: "src/assets/case.png" }), "rejected"],
  ["a path segment with a space", IDS.shareSlot, "share", imageValue({ path: "public/managed site/case one.png" }), "rejected"],
  ["non-ASCII path", IDS.shareSlot, "share", imageValue({ path: "public/caf\u00e9/\u00fc.png" }), "rejected"],
  ["webp", IDS.shareSlot, "share", imageValue({ path: "public/a.webp", mimeType: "image/webp" }), "accepted"],
  ["mime the slot does not output", IDS.shareSlot, "share", imageValue({ mimeType: "image/avif" }), "rejected"],
  ["wrong aspect ratio", IDS.shareSlot, "share", imageValue({ height: 601 }), "rejected"],
  ["too wide", IDS.shareSlot, "share", imageValue({ width: 8192, height: 4096 }), "rejected"],
  ["too many bytes", IDS.shareSlot, "share", imageValue({ bytes: 5_000_001 }), "rejected"],
  ["a crop", IDS.shareSlot, "share", imageValue({ crop: { x: 0, y: 0, width: 0.5, height: 0.5 } }), "accepted"],
  ["a focal point", IDS.shareSlot, "share", imageValue({ focalPoint: { x: 1, y: 0 } }), "accepted"],
  ["focal point out of range", IDS.shareSlot, "share", imageValue({ focalPoint: { x: 1.5, y: 0 } }), "rejected"],
  ["public alone", IDS.shareSlot, "share", imageValue({ path: "public" }), "rejected"],
];

const IMAGE_FIELDS: Readonly<Record<string, string>> = {
  fixed: IDS.fixedImage,
  decorative: IDS.decorativeImage,
  share: IDS.shareImage,
};

const imageProps = (image: unknown): unknown => {
  const { src, alt, width, height, focalPoint, crop } = image as JsonObject;
  return { src, alt, width, height, focalPoint, crop };
};

test("images: contract accepts => reader renders", async (t) => {
  const tally = newTally();
  for (const [name, slot, where, value, expected] of IMAGE_CASES) {
    const site = runtimeSite();
    if (where === "share") (homeDocument(site).meta as JsonObject).image = value;
    else (homeDocument(site).images as JsonObject)[where] = value;
    await judge(
      tally,
      name,
      site,
      expected,
      () => imageProps(runtime.resolveManagedImage(slot, value)),
      (loaded) => imageProps(loaded.managedImage(IMAGE_FIELDS[where] ?? "")),
    );
  }
  report(t, "images", tally);
});

/** Search text and the contract's verdict (the fixture's fields forbid newlines, max 170). */
const SEO_VALUES: readonly [string, Outcome][] = [
  ["", "accepted"],
  [" ", "accepted"],
  ["   ", "accepted"],
  ["\t", "rejected"],
  ["x", "accepted"],
  [" padded ", "accepted"],
  ["<script>alert(1)</script>", "accepted"],
  ["Caf\u00e9 \u{1f600}", "accepted"],
  ["a".repeat(170), "accepted"],
  ["a".repeat(171), "rejected"],
  ["line\nbreak", "rejected"],
  ["bidi \u202e", "rejected"],
];

test("search text: contract accepts => managedMetadata renders it, or the default when blank", async (t) => {
  const tally = newTally();
  for (const [value, expected] of SEO_VALUES) {
    for (const slot of ["title", "description"] as const) {
      const site = runtimeSite();
      (homeDocument(site).meta as JsonObject)[slot] = value;
      const shown = value.trim() === "" ? "Default" : value;
      await judge(
        tally,
        `${slot} ${JSON.stringify(value)}`,
        site,
        expected,
        () => shown,
        (loaded) => loaded.managedMetadata(IDS.homePage, { title: "Default", description: "Default", openGraph: {} })[slot],
      );
    }
  }
  report(t, "search text", tally);
});

function homeMetadata(site: RuntimeSite): JsonObject {
  const [homeSeo] = (site.contract.internalSeo as JsonObject).pages as JsonObject[];
  return (homeSeo as JsonObject).metadata as JsonObject;
}

function protectedField(site: RuntimeSite, fieldId: string): JsonObject {
  const field = ((site.contract.internalSeo as JsonObject).protectedFields as JsonObject[]).find((one) => one.id === fieldId);
  if (field === undefined) throw new Error(`no protected field ${fieldId}`);
  return field;
}

/**
 * Metadata slots whose field is owned by someone other than the page being
 * rendered. A reader must find each value where the projection stored it --
 * under the field's own declaration -- never under the rendered page.
 */
const OWNER_CASES: readonly [string, (site: RuntimeSite) => void, Outcome][] = [
  ["home's canonical slot names /about's canonical", (site) => void (homeMetadata(site).canonical = IDS.aboutCanonical), "accepted"],
  [
    "home's canonical is a site-scoped protected field",
    (site) => void (protectedField(site, homeMetadata(site).canonical as string).scope = "site"),
    "accepted",
  ],
  [
    "/about's description slot names a site-scoped protected field",
    (site) => void (protectedField(site, IDS.aboutDescription).scope = "site"),
    "accepted",
  ],
  [
    "home and /about both name one site-scoped canonical",
    (site) => {
      protectedField(site, IDS.aboutCanonical).scope = "site";
      homeMetadata(site).canonical = IDS.aboutCanonical;
    },
    "accepted",
  ],
  [
    // An editable seo_* field must be named by its own page's slot, so home
    // cannot swap its editable description for a protected one while keeping it.
    "home's description slot names a protected field, orphaning its editable one",
    (site) => void (homeMetadata(site).description = IDS.aboutDescription),
    "rejected",
  ],
  [
    "home's share image field is owned by /about",
    (site) => void (renderedField(site, IDS.shareImage).usages = [{ pageId: IDS.aboutPage, itemId: null }]),
    "rejected",
  ],
];

test("metadata: a slot's value is read from its field's owner, never the rendered page", async (t) => {
  const tally = newTally();
  for (const [name, change, expected] of OWNER_CASES) {
    const site = runtimeSite();
    change(site);
    await judge(tally, name, site, expected, () => true, (loaded) => {
      // A card, so the share image and its canonical origin are read too.
      const card = { title: "Default", description: "Default", openGraph: { type: "website" } };
      loaded.managedMetadata(IDS.homePage, card);
      loaded.managedMetadata(IDS.aboutPage, card);
      return true;
    });
  }
  report(t, "metadata owners", tally);
});

function usedOn(site: RuntimeSite, fieldId: string, pageId: string): void {
  renderedField(site, fieldId).usages = [{ pageId, itemId: null }];
}

/**
 * Rendered fields whose usage is not the page that declares them. The
 * projection stores each under its first usage's page, so every reader must
 * read it there, through the site the way a page does.
 */
const USAGE_CASES: readonly [string, (site: RuntimeSite) => void, Outcome][] = [
  ["a link field whose first usage is the generated page", (site) => usedOn(site, IDS.homeLink, IDS.servicePage), "accepted"],
  [
    "a link, an image and a rich-text field declared on home and used on /about",
    (site) => {
      usedOn(site, IDS.externalLink, IDS.aboutPage);
      usedOn(site, IDS.fixedImage, IDS.aboutPage);
      usedOn(site, IDS.body, IDS.aboutPage);
    },
    "accepted",
  ],
];

test("rendered fields: a value is read from its first usage's page, not its declaring page", async (t) => {
  const tally = newTally();
  const fields = (loaded: GeneratedRuntime): unknown => [
    anchor(loaded.managedLink(IDS.homeLink)),
    anchor(loaded.managedLink(IDS.externalLink)),
    imageProps(loaded.managedImage(IDS.fixedImage)),
    html(loaded.managedRichTextBlocks(IDS.body).value),
  ];
  const expectedReads = fields(runtime);
  for (const [name, change, expected] of USAGE_CASES) {
    const site = runtimeSite();
    change(site);
    await judge(tally, name, site, expected, () => expectedReads, fields);
  }
  report(t, "usage owners", tally);
});

type Mark = JsonObject;
const BOLD: Mark = { type: "bold" };
const ITALIC: Mark = { type: "italic" };
const LINK: Mark = { type: "link", destination: external("https://example.com/a"), target: "same_window" };
const NEW_WINDOW_LINK: Mark = { type: "link", destination: external("https://example.com/b"), target: "new_window" };
const PAGE_LINK: Mark = { type: "link", destination: internalTo(IDS.aboutPage, "team"), target: "same_window" };

function orderings(marks: readonly Mark[]): Mark[][] {
  if (marks.length === 0) return [[]];
  return marks.flatMap((mark, index) =>
    orderings([...marks.slice(0, index), ...marks.slice(index + 1)]).map((rest) => [mark, ...rest]),
  );
}

function subsets(marks: readonly Mark[]): Mark[][] {
  return marks.reduce<Mark[][]>((all, mark) => [...all, ...all.map((subset) => [...subset, mark])], [[]]).filter((one) => one.length > 0);
}

const run = (value: string, marks?: readonly Mark[]): JsonObject =>
  marks === undefined || marks.length === 0 ? { type: "text", text: value } : { type: "text", text: value, marks };
const label = (marks: readonly Mark[]): string =>
  marks.map((mark) => (mark.type === "link" ? `link(${String(mark.target)})` : String(mark.type))).join(">");

/**
 * One block each: every order of every subset of bold, italic and link on one
 * run (15), then runs beside and inside each other. Rendered by the whole-
 * document reader and by #104's formatted-block reader, the markup inside the
 * block must be identical, data-gomega-mark included.
 */
const ONE_RENDERER_CASES: readonly [string, JsonObject, Outcome][] = [
  ...subsets([BOLD, ITALIC, LINK]).flatMap(orderings).map(
    (marks): [string, JsonObject, Outcome] => [label(marks), { type: "paragraph", content: [run("x", marks)] }, "accepted"],
  ),
  ["adjacent runs sharing their outer mark", { type: "paragraph", content: [run("a", [BOLD, ITALIC]), run("b", [BOLD])] }, "accepted"],
  ["the same mark on two adjacent runs", { type: "paragraph", content: [run("a", [BOLD]), run("b", [BOLD])] }, "accepted"],
  ["two different links side by side", { type: "paragraph", content: [run("a", [LINK]), run("b", [NEW_WINDOW_LINK])] }, "accepted"],
  ["a new-window link around bold", { type: "paragraph", content: [run("a", [NEW_WINDOW_LINK, BOLD])] }, "accepted"],
  ["an internal link with a fragment", { type: "paragraph", content: [run("team", [PAGE_LINK, ITALIC])] }, "accepted"],
  ["plain between marks", { type: "paragraph", content: [run("a", [ITALIC]), run(" b "), run("c", [ITALIC])] }, "accepted"],
  ["an empty text run", { type: "paragraph", content: [run(""), run("x", [BOLD])] }, "accepted"],
  ["a level 1 heading with marks", { type: "heading", attrs: { level: 1 }, content: [run("h", [ITALIC, BOLD])] }, "accepted"],
  ["a level 2 heading with marks", { type: "heading", attrs: { level: 2 }, content: [run("h", [ITALIC, BOLD])] }, "accepted"],
  ["a level 3 heading with marks", { type: "heading", attrs: { level: 3 }, content: [run("h", [ITALIC, BOLD])] }, "accepted"],
  ["markup in marked text", { type: "paragraph", content: [run("<script>x</script>", [BOLD, LINK])] }, "accepted"],
  ["a new-window external link", { type: "paragraph", content: [run("x", [NEW_WINDOW_LINK])] }, "accepted"],
  [
    "a new-window internal link with a fragment",
    { type: "paragraph", content: [run("team", [{ ...PAGE_LINK, target: "new_window" }])] },
    "accepted",
  ],
  ["a same-window link, which takes no rel", { type: "paragraph", content: [run("x", [LINK])] }, "accepted"],
  ["bold around a new-window link", { type: "paragraph", content: [run("x", [BOLD, NEW_WINDOW_LINK])] }, "accepted"],
  ["one mark twice on one run", { type: "paragraph", content: [run("x", [BOLD, BOLD])] }, "rejected"],
];

/** A block's tag: a heading's is its level's, so each level is checked at its own rank. */
function tagOf(block: JsonObject): string {
  if (block.type !== "heading") return "p";
  const attrs = block.attrs as { readonly level: number };
  return `h${String(attrs.level)}`;
}
const REL = ' rel="noopener noreferrer"';

test("one rich-text renderer: a document's blocks render exactly as #104's formatted-block reader", async (t) => {
  const tally = newTally();
  for (const [name, block, expected] of ONE_RENDERER_CASES) {
    const document = { type: "doc", content: [block] };
    const tag = tagOf(block);
    await judge(
      tally,
      name,
      siteWithDocument(RICH_OPEN, document),
      expected,
      () => html(runtime.renderManagedRichText(document)),
      (loaded) => {
        const blocks = html(loaded.managedRichTextBlocks(IDS.body).value);
        const formatted = `<${tag}>${html(loaded.managedRichText(IDS.body, {}).content)}</${tag}>`;
        // One link builder: both readers carry rel on a new-window link.
        assert.equal(blocks, formatted, `${name}: the two readers agree`);
        const newWindowLinks = (blocks.match(/target="_blank"/gu) ?? []).length;
        assert.equal(blocks.split(REL).length - 1, newWindowLinks, `${name}: rel on every new-window link, and only there`);
        return blocks;
      },
    );
  }
  report(t, "one renderer", tally);
});

test("the differential is not vacuous: each domain has cases on both sides", () => {
  const destinations = LINKS.destinationCases.map((entry) => entry.expected.outcome);
  assert.ok(destinations.includes("accepted") && destinations.includes("rejected"));
  assert.ok(renders(() => runtime.resolveManagedLink(linkValue(internalTo(IDS.aboutPage)))));
  assert.equal(renders(() => runtime.resolveManagedLink(linkValue(external("javascript:alert(1)")))), false);
});
