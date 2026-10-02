import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import test from "node:test";

import { renderToStaticMarkup } from "react-dom/server";
import { createElement, type ReactElement } from "react";
import ts from "typescript";

import { READER_CONTRACT_IMPORTS, READER_MODULE_IMPORTS, RUNTIME_READERS, runtimeModule } from "../src/runtime-module.js";
import { configFor, run, workspace } from "./support/proposals.js";
import { external, internalTo, linkValue, paragraph, text } from "./support/reader-cases.js";
import {
  IDS,
  RICH_TEXT_DOCUMENT,
  homeDocument,
  loadRuntime,
  runtimeSite,
  writeRuntimeSite,
  type GeneratedRuntime,
  type JsonObject,
  type RuntimeSite,
} from "./support/runtime-site.js";

/**
 * The readers are run, not read: each case writes a site and its GENERATED
 * runtime into a scratch repository and imports it, so the contract package
 * validates the content exactly as a converted site's build does, and what a
 * reader returns is what a component would render.
 */

const html = (node: unknown): string => renderToStaticMarkup(node as ReactElement);

function variant(change: (site: RuntimeSite) => void): RuntimeSite {
  const site = runtimeSite();
  change(site);
  return site;
}

function homeField(site: RuntimeSite, pointer: string): JsonObject {
  return pointer
    .split("/")
    .slice(1)
    .reduce<JsonObject>((node, key) => node[key] as JsonObject, homeDocument(site));
}

const runtime = await loadRuntime(runtimeSite());

test("the generated runtime type-checks as a converted Next site compiles it", () => {
  const file = writeRuntimeSite(runtimeSite());
  const program = ts.createProgram([file], {
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2022,
    lib: ["lib.dom.d.ts", "lib.es2022.d.ts"],
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    resolveJsonModule: true,
    esModuleInterop: true,
    isolatedModules: true,
    jsx: ts.JsxEmit.Preserve,
    types: [],
    baseUrl: dirname(file),
  });
  const diagnostics = ts
    .getPreEmitDiagnostics(program)
    .filter((one) => one.file?.fileName.startsWith(dirname(file)) ?? true);
  assert.deepEqual(
    diagnostics.map((one) => ts.flattenDiagnosticMessageText(one.messageText, " ")),
    [],
  );
});

const MAIN = JSON.parse(
  readFileSync(new URL("./support/main-runtime-sha256.json", import.meta.url), "utf8"),
) as { readonly digests: Readonly<Record<string, string>> };

/** Removes one whole occurrence of `part`, or fails naming what is missing. */
function without(text: string, part: string, what: string): string {
  const at = text.indexOf(part);
  assert.notEqual(at, -1, `the generated module has no ${what}`);
  assert.equal(text.indexOf(part, at + 1), -1, `the generated module has two ${what}`);
  return text.slice(0, at) + text.slice(at + part.length);
}

test("every fixture's WHOLE runtime is main's, plus exactly the three reader additions", () => {
  const fixtures = Object.keys(MAIN.digests).sort();
  const onDisk = readdirSync(new URL("./fixtures", import.meta.url))
    .filter((name) => name !== "runtimereaders")
    .sort();
  assert.deepEqual(fixtures, onDisk, "every converter fixture has main's digest, and no digest is stale");
  for (const fixture of fixtures) {
    const space = workspace(fixture, configFor(["/"]));
    const emitted = runtimeModule(run(space), "src/content").text;
    assert.equal(emitted.endsWith(RUNTIME_READERS), true, `${fixture}: the readers are the suffix`);
    let rest = emitted.slice(0, -RUNTIME_READERS.length);
    rest = without(rest, READER_CONTRACT_IMPORTS, "reader names in the contract import");
    rest = without(rest, READER_MODULE_IMPORTS, "next and react imports");
    assert.equal(createHash("sha256").update(rest).digest("hex"), MAIN.digests[fixture], `${fixture}: the rest is main's`);
  }
});

// ---------------------------------------------------------------------------
// Order
// ---------------------------------------------------------------------------

test("managedOrder is the customer's order, and managedItemById joins each row by id", () => {
  assert.deepEqual(runtime.managedOrder(IDS.faq), [IDS.secondItem, IDS.firstItem]);
  const rows = runtime.managedOrder(IDS.faq).map((itemId) => {
    const item = runtime.managedItemById(IDS.faq, itemId);
    return [item.itemId, item.value(IDS.faqQuestion), item.link(IDS.itemLink).href];
  });
  assert.deepEqual(rows, [
    [IDS.secondItem, "TODO_FAQ_QUESTION_TWO — what areas do you serve?", "/about"],
    [IDS.firstItem, "TODO_FAQ_QUESTION_ONE — what services do you offer?", "https://example.com/first"],
  ]);
  // The source-index reader is untouched: position 0 is still the source's first item.
  assert.equal(
    runtime.managedItem(IDS.faq, 0).value(IDS.faqQuestion),
    "TODO_FAQ_QUESTION_ONE — what services do you offer?",
  );
  assert.deepEqual(runtime.managedItemById(IDS.faq, IDS.secondItem).attributes(IDS.faqQuestion), {
    "data-gomega-field-id": IDS.faqQuestion,
    "data-gomega-item-id": IDS.secondItem,
  });
});

test("an unknown item, collection or item field throws", () => {
  const unknownItem = "item_0000000000000000000000zzz0";
  const cases: readonly [string, () => unknown, RegExp][] = [
    ["unknown item id", () => runtime.managedItemById(IDS.faq, unknownItem), /is not an item of/u],
    ["item id of another shape", () => runtime.managedItemById(IDS.faq, "0"), /is not an item of/u],
    ["unknown collection (order)", () => runtime.managedOrder("collection_0000000000000000000000zzz0"), /not a collection/u],
    ["unknown collection (item)", () => runtime.managedItemById("collection_0000000000000000000000zzz0", IDS.firstItem), /not a collection/u],
    ["field of no collection", () => runtime.managedItemById(IDS.faq, IDS.firstItem).value(IDS.heroTitle), /is not a field of/u],
    ["link read as text", () => runtime.managedItemById(IDS.faq, IDS.firstItem).value(IDS.itemLink), /not text/u],
    ["text read as link", () => runtime.managedItemById(IDS.faq, IDS.firstItem).link(IDS.faqQuestion), /not link/u],
  ];
  for (const [name, read, message] of cases) assert.throws(read, message, name);
});

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

test("managedLink resolves every destination kind", () => {
  const link = (fieldId: string) => {
    const { href, label, target, rel } = runtime.managedLink(fieldId);
    return { href, label, target, rel };
  };
  assert.deepEqual(link(IDS.internalLink), { href: "/about#team", label: "Meet the team", target: undefined, rel: undefined });
  assert.deepEqual(link(IDS.homeLink), { href: "/", label: "Home", target: undefined, rel: undefined });
  assert.deepEqual(link(IDS.externalLink), {
    href: "https://example.com/brochure.pdf?x=1&y=2",
    label: "Brochure",
    target: "_blank",
    rel: "noopener noreferrer",
  });
  assert.deepEqual(link(IDS.emailLink), { href: "mailto:hello@example.com", label: "Email us", target: undefined, rel: undefined });
  assert.deepEqual(link(IDS.phoneLink), { href: "tel:+15555550100", label: "Call us", target: undefined, rel: undefined });
  assert.deepEqual(runtime.managedLink(IDS.emailLink).attributes, { "data-gomega-field-id": IDS.emailLink });
});

test("a link to a generated page, field or prose, fails the build; the reader invents no URL", async () => {
  const field = variant((one) => void (homeField(one, "/links/home").destination = internalTo(IDS.servicePage, "team")));
  await assert.rejects(loadRuntime(field), /no single path/u, "the contract refuses a link field to it (0.13.0)");
  // The reader's own refusal, which no value the contract accepts reaches.
  assert.throws(
    () => runtime.resolveManagedLink(linkValue(internalTo(IDS.servicePage, "team"))),
    /managed-site: .* has no single path to link to/u,
  );
  const prose = variant((one) => {
    homeField(one, "/body").content = [
      paragraph(text("services", [{ type: "link", destination: internalTo(IDS.servicePage, "top"), target: "same_window" }])),
    ];
  });
  await assert.rejects(loadRuntime(prose), /no single path/u, "the contract refuses it before any reader runs");
});

test("a URL the contract admits resolves as written, whatever it carries after the host", () => {
  for (const url of ["https://example.com", "https://example.com/a?q={x}|y^z&w=1#frag", "https://sub.example.co.uk/%3Cscript%3E"]) {
    assert.equal(runtime.resolveManagedLink(linkValue(external(url))).href, url);
  }
});

test("a javascript: or http: destination in a site's content fails the build", async () => {
  for (const url of ["javascript:alert(1)", "http://example.com/"]) {
    const site = variant((one) => {
      homeField(one, "/links/external").destination = { kind: "external", url };
    });
    await assert.rejects(loadRuntime(site), Error, url);
  }
});

test("a link to a page the contract does not declare fails the build", async () => {
  const site = variant((one) => {
    homeField(one, "/links/internal").destination = internalTo("page_0000000000000000000000zzz0", null);
  });
  await assert.rejects(loadRuntime(site));
});

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

test("managedImage serves public/ from the root and takes alt from the slot's policy", () => {
  const image = (fieldId: string) => {
    const { src, alt, width, height, focalPoint } = runtime.managedImage(fieldId);
    return { src, alt, width, height, focalPoint };
  };
  assert.deepEqual(image(IDS.fixedImage), {
    src: "/managed-site-cms/logo.png",
    alt: "Company logo",
    width: 1200,
    height: 600,
    focalPoint: null,
  });
  assert.deepEqual(image(IDS.decorativeImage), {
    src: "/managed-site-cms/texture.webp",
    alt: "",
    width: 1200,
    height: 600,
    focalPoint: { x: 0.25, y: 0.75 },
  });
  assert.equal(image(IDS.heroImage).alt, "TODO_BUSINESS_NAME logo", "informative: the value's own alt");
});

test("an image its slot does not admit, or one outside public/, fails the build; the reader refuses an unserved path", async () => {
  const refused: readonly [string, (site: RuntimeSite) => void][] = [
    ["decorative with alt text", (site) => void (homeField(site, "/images/decorative").altText = "not decorative")],
    ["fixed_alt with its own alt", (site) => void (homeField(site, "/images/fixed").altText = "mine")],
    // Contract 0.12.0: an image must be under public/.
    ["outside public/", (site) => void (homeField(site, "/images/fixed").path = "src/assets/logo.png")],
  ];
  for (const [name, change] of refused) await assert.rejects(loadRuntime(variant(change)), Error, name);
  // The reader's own refusal, which no value the contract accepts reaches.
  assert.throws(
    () => runtime.resolveManagedImage(IDS.fixedSlot, { ...(homeField(runtimeSite(), "/images/fixed")), path: "src/assets/logo.png" }),
    /managed-site: /u,
  );
});

test("Next serves public/: a conversion may not place images elsewhere, and a subdirectory renders under /", async () => {
  assert.throws(
    () => run(workspace("clientcollection", { ...(configFor(["/"]) as JsonObject), assetRoot: "public/images" })),
    /not the served root/u,
    "placement and serving must agree",
  );
  const placed = await loadRuntime(
    variant((site) => {
      homeField(site, "/images/fixed").path = "public/images/logo.png";
      homeField(site, "/images/decorative").path = "public/managed-site-cms/texture.webp";
    }),
  );
  assert.equal(placed.managedImage(IDS.fixedImage).src, "/images/logo.png", "a file under public/images");
  assert.equal(placed.managedImage(IDS.decorativeImage).src, "/managed-site-cms/texture.webp", "uploaded by the CMS");
});

const IMAGE_1200x600 = { width: 1200, height: 600 };

/** The largest double below a positive finite one. */
function nextDoubleBelow(value: number): number {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value);
  view.setBigUint64(0, view.getBigUint64(0) - 1n);
  return view.getFloat64(0);
}

test("a one-pixel crop, written 1/w, renders finite styles; below one pixel the reader refuses", async () => {
  // 49 is the first side whose 1/w a product check rounds wrongly; 1024 is exact.
  for (const [width, height, axis] of [[1024, 512, "width"], [98, 49, "height"], [49, 1, "width"]] as const) {
    const side = axis === "width" ? width : height;
    const crop = axis === "width" ? { x: 0, y: 0, width: 1 / side, height: 1 } : { x: 0, y: 0, width: 1, height: 1 / side };
    const styles = runtime.managedImageCrop({ width, height, crop });
    assert.notEqual(styles, null, `${String(side)}: a crop`);
    for (const value of [...Object.values(styles?.frame ?? {}), ...Object.values(styles?.image ?? {})]) {
      assert.doesNotMatch(String(value), /Infinity|NaN/u, `${String(side)}: ${String(value)}`);
    }
    assert.equal((styles?.image as JsonObject)[axis], `${String(100 * side)}%`, `${String(side)}: the zoom is 100 * side`);
    const below = axis === "width" ? { ...crop, width: nextDoubleBelow(1 / side) } : { ...crop, height: nextDoubleBelow(1 / side) };
    assert.throws(() => runtime.managedImageCrop({ width, height, crop: below }), /managed-site: a crop smaller than one pixel/u);
  }
  assert.throws(() => runtime.managedImageCrop({ ...IMAGE_1200x600, crop: { x: 0, y: 0, width: 1e-307, height: 1 } }), /managed-site: /u);
  // End to end: the contract accepts exactly 1/49 on a 98 x 49 image, and the site renders it.
  const loaded = await loadRuntime(
    variant((site) => {
      const image = homeField(site, "/images/decorative");
      Object.assign(image, { width: 98, height: 49, crop: { x: 0, y: 0, width: 1, height: 1 / 49 } });
    }),
  );
  const image = loaded.managedImage(IDS.decorativeImage);
  assert.equal((loaded.managedImageCrop(image)?.image as JsonObject).height, "4900%");
});

test("a whole-frame crop renders as before; any other crop is returned and rendered", async () => {
  assert.equal(runtime.managedImage(IDS.fixedImage).crop, null, "no crop");
  assert.equal(runtime.managedImageCrop({ ...IMAGE_1200x600, crop: null }), null);
  const cases: readonly [string, JsonObject, JsonObject | null][] = [
    ["whole frame", { x: 0, y: 0, width: 1, height: 1 }, null],
    [
      "the right half",
      { x: 0.5, y: 0, width: 0.5, height: 1 },
      {
        frame: { position: "relative", display: "block", overflow: "hidden", aspectRatio: "600 / 600" },
        image: { position: "absolute", maxWidth: "none", width: "200%", height: "100%", left: "-100%", top: "0%" },
      },
    ],
    [
      "a centred quarter",
      { x: 0.25, y: 0.25, width: 0.5, height: 0.5 },
      {
        frame: { position: "relative", display: "block", overflow: "hidden", aspectRatio: "600 / 300" },
        image: { position: "absolute", maxWidth: "none", width: "200%", height: "200%", left: "-50%", top: "-50%" },
      },
    ],
    [
      "a third, not a round fraction",
      { x: 0.1, y: 0.2, width: 0.3, height: 0.6 },
      {
        frame: { position: "relative", display: "block", overflow: "hidden", aspectRatio: "360 / 360" },
        image: { position: "absolute", maxWidth: "none", width: "333.33333%", height: "166.66667%", left: "-33.33333%", top: "-33.33333%" },
      },
    ],
  ];
  for (const [name, crop, styles] of cases) {
    const loaded = await loadRuntime(variant((site) => void (homeField(site, "/images/decorative").crop = crop)));
    const image = loaded.managedImage(IDS.decorativeImage);
    assert.deepEqual(image.crop, styles === null ? null : crop, `${name}: the crop the reader returns`);
    assert.deepEqual(loaded.managedImageCrop(image), styles, `${name}: its styles`);
  }
});

// ---------------------------------------------------------------------------
// Rich text
// ---------------------------------------------------------------------------

test("managedRichTextBlocks renders every block and mark, escaping all text", () => {
  const body = runtime.managedRichTextBlocks(IDS.body);
  assert.deepEqual(body.attributes, { "data-gomega-field-id": IDS.body });
  assert.equal(
    html(body.value),
    [
      "<h2>Why &lt;script&gt;alert(1)&lt;/script&gt; us</h2>",
      '<p>Plain &amp; &lt;b&gt;simple&lt;/b&gt; <strong data-gomega-mark="bold">bold</strong> <em data-gomega-mark="italic">italic</em> ',
      '<strong data-gomega-mark="bold"><em data-gomega-mark="italic">both</em></strong> ',
      '<a href="/about#team" data-gomega-mark="link">the team</a> ',
      // Marks are outermost-first: [bold, link] is strong around a.
      '<strong data-gomega-mark="bold"><a href="https://example.com/a?b=1&amp;c=2" target="_blank" rel="noopener noreferrer" data-gomega-mark="link">brochure</a></strong></p>',
      "<h3>Lists</h3>",
      "<ul><li><p>one</p></li><li><p>two</p></li></ul>",
      "<ol><li><p>first</p><p>second para</p></li></ol>",
      '<blockquote><p><a href="mailto:hello@example.com" data-gomega-mark="link">mail</a> or <a href="tel:+15555550100" data-gomega-mark="link">call</a></p></blockquote>',
    ].join(""),
  );
});

test("a site's own link template receives the rel a new window needs, from the one link builder", async () => {
  const loaded = await loadRuntime(
    variant((site) => {
      homeField(site, "/body").content = [
        paragraph(
          text("new", [{ type: "link", destination: external("https://example.com/a"), target: "new_window" }]),
          text(" same", [{ type: "link", destination: external("https://example.com/b"), target: "same_window" }]),
        ),
      ];
    }),
  );
  // What the rewrite writes for a source link with no rel: href, target and rel from the binding.
  const siteTemplate = {
    link: (children: unknown, link: JsonObject) =>
      createElement("a", { className: "underline", href: link.href, target: link.target, rel: link.rel }, children as never),
  };
  assert.equal(
    html(loaded.managedRichText(IDS.body, siteTemplate).content),
    '<a class="underline" href="https://example.com/a" target="_blank" rel="noopener noreferrer">new</a>' +
      '<a class="underline" href="https://example.com/b"> same</a>',
  );
});

test("renderManagedRichText renders a document exactly as the field reader does", () => {
  assert.equal(html(runtime.renderManagedRichText(RICH_TEXT_DOCUMENT)), html(runtime.managedRichTextBlocks(IDS.body).value));
});

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

const FALLBACK = {
  title: "Literal title",
  description: "Literal description",
  alternates: { canonical: "https://todo.example.com/" },
  robots: { index: false, follow: true },
  openGraph: { type: "website", siteName: "Fixture" },
};
/** Absolute, on the origin of the page's protected canonical (https://todo.example.com/...). */
const SHARE_IMAGE = { url: "https://todo.example.com/managed-site-cms/share.png", width: 1200, height: 600, alt: "Share card" };

test("managedMetadata lays the customer's search text and share image over the literal", () => {
  assert.deepEqual(runtime.managedMetadata(IDS.homePage, FALLBACK), {
    ...FALLBACK,
    title: "Managed title",
    description: "Managed description",
    openGraph: {
      type: "website",
      siteName: "Fixture",
      title: "Managed title",
      description: "Managed description",
      images: [SHARE_IMAGE],
    },
  });
  const withTwitter = runtime.managedMetadata(IDS.homePage, { ...FALLBACK, twitter: { card: "summary_large_image" } });
  assert.deepEqual(withTwitter.twitter, {
    card: "summary_large_image",
    title: "Managed title",
    description: "Managed description",
    images: [SHARE_IMAGE],
  });
  assert.equal(withTwitter.alternates, FALLBACK.alternates, "canonical is the fallback's, untouched");
  assert.equal(withTwitter.robots, FALLBACK.robots, "indexing is the fallback's, untouched");
});

test("blank search text means the page default", async () => {
  for (const [title, description] of [["", ""], ["   ", " "]] as const) {
    const blank = await loadRuntime(
      variant((site) => {
        homeField(site, "/meta").title = title;
        homeField(site, "/meta").description = description;
      }),
    );
    assert.deepEqual(blank.managedMetadata(IDS.homePage, FALLBACK), {
      ...FALLBACK,
      openGraph: { type: "website", siteName: "Fixture", images: [SHARE_IMAGE] },
    });
  }
});

test("an editable share card with no openGraph to land on is a developer error at build, before any edit", () => {
  // The fixture as converted: nobody has edited anything. Home's contract makes
  // its share image and social text editable, so metadata without openGraph
  // would drop every such edit silently; it fails the page's first build.
  const noCard: JsonObject = { ...FALLBACK };
  delete noCard.openGraph;
  assert.throws(() => runtime.managedMetadata(IDS.homePage, noCard), /share card is customer-editable.*no openGraph/su);
  // A page with nothing editable on its card keeps the layout's card.
  const about = runtime.managedMetadata(IDS.aboutPage, noCard);
  assert.equal("openGraph" in about, false, "a page-level openGraph would replace the layout's whole card");
});

test("an edited title keeps the shape of fallback's, so an absolute title stays out of the template", () => {
  const title = (fallbackTitle: unknown): unknown =>
    runtime.managedMetadata(IDS.homePage, { ...FALLBACK, title: fallbackTitle }).title;
  assert.deepEqual(title({ absolute: "Brand | Roofing" }), { absolute: "Managed title" });
  assert.deepEqual(title({ absolute: "x", template: "%s | Brand" }), { absolute: "Managed title", template: "%s | Brand" });
  assert.deepEqual(title({ default: "x", template: "%s | Brand" }), { default: "Managed title", template: "%s | Brand" });
  assert.equal(title("Literal"), "Managed title");
  assert.equal(title(undefined), "Managed title");
});

function withNullSocialSlots(site: RuntimeSite): void {
  const [homeSeo] = (site.contract.internalSeo as JsonObject).pages as JsonObject[];
  const social = ((homeSeo as JsonObject).metadata as JsonObject).social as JsonObject;
  social.title = null;
  social.description = null;
}

test("with null social slots, a share card that states a title or description follows the edit", async () => {
  const nullSlots = await loadRuntime(variant(withNullSocialSlots));
  const stale = {
    ...FALLBACK,
    openGraph: { type: "website", title: "Old og title", description: "Old og description" },
    twitter: { card: "summary", title: "Old twitter title" },
  };
  const metadata = nullSlots.managedMetadata(IDS.homePage, stale);
  assert.deepEqual(metadata.openGraph, {
    type: "website",
    title: "Managed title",
    description: "Managed description",
    images: [SHARE_IMAGE],
  });
  assert.deepEqual(
    metadata.twitter,
    { card: "summary", title: "Managed title", images: [SHARE_IMAGE] },
    "a card that never stated a description gains none",
  );
  assert.deepEqual(
    nullSlots.managedMetadata(IDS.homePage, FALLBACK).openGraph,
    { type: "website", siteName: "Fixture", images: [SHARE_IMAGE] },
    "a card that states no title gains none",
  );
  const blankEdit = await loadRuntime(
    variant((site) => {
      withNullSocialSlots(site);
      homeField(site, "/meta").title = "  ";
    }),
  );
  assert.equal(
    (blankEdit.managedMetadata(IDS.homePage, stale).openGraph as JsonObject).title,
    "Old og title",
    "a blank edit leaves the card as the site wrote it",
  );
});

test("a page whose metadata is protected, or a generated page, keeps its literal", () => {
  assert.deepEqual(runtime.managedMetadata(IDS.aboutPage, FALLBACK), FALLBACK);
  assert.equal(runtime.managedMetadata(IDS.servicePage, FALLBACK), FALLBACK);
});

test("an unknown page, or a missing field, throws", async () => {
  assert.throws(() => runtime.managedMetadata("page_0000000000000000000000zzz0", FALLBACK), /not a page in the contract/u);
  const unknownField = "field_0000000000000000000000zzz0";
  const readers: readonly [string, (one: GeneratedRuntime) => unknown][] = [
    ["managedText", (one) => one.managedText(unknownField)],
    ["managedLink", (one) => one.managedLink(unknownField)],
    ["managedImage", (one) => one.managedImage(unknownField)],
    ["managedRichTextBlocks", (one) => one.managedRichTextBlocks(unknownField)],
    ["managedLink on text", (one) => one.managedLink(IDS.heroTitle)],
    ["managedImage on a link", (one) => one.managedImage(IDS.homeLink)],
    ["managedRichTextBlocks on an image", (one) => one.managedRichTextBlocks(IDS.heroImage)],
  ];
  for (const [name, read] of readers) assert.throws(() => read(runtime), /managed-site: /u, name);
  // A declared field whose source value is gone is refused before any reader runs.
  const missing = variant((site) => {
    delete homeField(site, "/meta").title;
  });
  await assert.rejects(loadRuntime(missing));
});
