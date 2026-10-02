import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { CONTRACT_FILE, runtimeModule } from "../../src/runtime-module.js";

/**
 * A converted site whose content exercises every runtime reader, and the
 * plumbing to load the runtime GENERATED for it.
 *
 * The base is site-starter's own contract (a known-valid site: hero image, FAQ
 * collection, protected SEO), copied into `fixtures/runtimereaders`. Each layer
 * below adds what that base lacks -- a second page to link to, a link of every
 * destination kind, a fixed_alt and a decorative image, a rich-text field using
 * the whole grammar, a collection the customer has reordered, and editable
 * search text with a share image -- so the contract package validates the
 * whole thing exactly as it validates a real site's.
 */

export type JsonObject = Record<string, unknown>;

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "runtimereaders");
const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const HOME = "src/content/pages/home.json";
const ABOUT = "src/content/pages/about.json";
const SITE = "src/content/site.json";

function stableId(kind: string, n: number): string {
  return `${kind}_${`rr${String(n)}`.padStart(25, "0")}0`;
}

export const IDS = {
  homePage: "page_00000000000000000000000020",
  aboutPage: stableId("page", 1),
  aboutSection: stableId("section", 2),
  aboutHeading: stableId("field", 3),
  readersSection: stableId("section", 4),
  internalLink: stableId("field", 5),
  homeLink: stableId("field", 6),
  externalLink: stableId("field", 7),
  emailLink: stableId("field", 8),
  phoneLink: stableId("field", 9),
  body: stableId("field", 10),
  fixedImage: stableId("field", 11),
  decorativeImage: stableId("field", 12),
  fixedSlot: stableId("asset", 13),
  decorativeSlot: stableId("asset", 14),
  searchSection: stableId("section", 15),
  seoTitle: stableId("field", 16),
  seoDescription: stableId("field", 17),
  shareImage: stableId("field", 18),
  shareSlot: stableId("asset", 19),
  itemLink: stableId("field", 20),
  aboutTitle: stableId("field", 21),
  aboutDescription: stableId("field", 22),
  aboutCanonical: stableId("field", 23),
  aboutIndexing: stableId("field", 24),
  services: stableId("collection", 25),
  servicePage: stableId("page", 26),
  serviceSlug: stableId("field", 27),
  serviceName: stableId("field", 28),
  serviceTitle: stableId("field", 29),
  serviceDescription: stableId("field", 30),
  serviceCanonical: stableId("field", 31),
  serviceIndexing: stableId("field", 32),
  servicesOrder: stableId("field", 33),
  roofing: stableId("item", 34),
  heroImage: "field_00000000000000000000000090",
  heroTitle: "field_00000000000000000000000070",
  faq: "collection_000000000000000000000000d0",
  faqQuestion: "field_000000000000000000000000e0",
  firstItem: "item_000000000000000000000000g0",
  secondItem: "item_000000000000000000000000h0",
} as const;

export interface RuntimeSite {
  readonly contract: JsonObject;
  /** Repository path to document, as the runtime imports them. */
  readonly documents: Map<string, JsonObject>;
}

function readJson(path: string): JsonObject {
  return JSON.parse(readFileSync(join(FIXTURE, path), "utf8")) as JsonObject;
}

function objects(value: unknown): JsonObject[] {
  return value as JsonObject[];
}

function presentation(name: string, order: number): JsonObject {
  return { name, description: null, group: "Readers", order, example: null };
}

function resolver(path: string, pointer: string): JsonObject {
  return { kind: "json_pointer", path, pointer };
}

function usage(pageId: string): JsonObject[] {
  return [{ pageId, itemId: null }];
}

const LINK_CONSTRAINTS = {
  labelConstraints: { minLength: 1, maxLength: 200, newlines: "forbid" },
  authority: "internal_or_external",
  allowedSchemes: ["https", "mailto", "tel"],
  allowedExternalHosts: ["example.com"],
  fragmentPolicy: "declared",
  allowedFragments: ["team"],
  allowedTargets: ["same_window", "new_window"],
};

const LINK_CAPABILITIES = ["link.label.edit", "link.destination.edit", "link.target.edit"];

function pageField(id: string, pointer: string, order: number, shape: JsonObject): JsonObject {
  return {
    id,
    scope: "page",
    classification: "customer_editable",
    resolver: resolver(HOME, pointer),
    usages: usage(IDS.homePage),
    presentation: presentation(pointer, order),
    ...shape,
  };
}

function linkField(id: string, pointer: string, order: number): JsonObject {
  return pageField(id, pointer, order, {
    type: "link",
    capabilities: LINK_CAPABILITIES,
    constraints: LINK_CONSTRAINTS,
  });
}

function imageField(id: string, pointer: string, order: number, assetSlotId: string): JsonObject {
  return pageField(id, pointer, order, {
    type: "image",
    capabilities: ["image.upload", "image.alt.edit"],
    assetSlotId,
  });
}

function seoTextField(id: string, semantic: string, order: number): JsonObject {
  return pageField(id, `/meta/${semantic === "seo_title" ? "title" : "description"}`, order, {
    type: "plain_text",
    capabilities: ["text.edit"],
    semantic,
    constraints: { minLength: 0, maxLength: 170, newlines: "forbid" },
  });
}

function slot(id: string, semantics: JsonObject): JsonObject {
  return {
    id,
    presentation: presentation(id, 1),
    semantics,
    acceptedMimeTypes: ["image/png", "image/webp"],
    outputMimeTypes: ["image/png", "image/webp"],
    minWidth: 1,
    maxWidth: 4096,
    minHeight: 1,
    maxHeight: 4096,
    aspectRatios: [{ width: 2, height: 1 }],
    cropPolicy: "optional",
    focalPointPolicy: "optional",
    maxBytes: 5_000_000,
  };
}

function imageValue(path: string, altText: string | null, focalPoint: JsonObject | null): JsonObject {
  return {
    path,
    sha256: "a".repeat(64),
    mimeType: path.endsWith(".webp") ? "image/webp" : "image/png",
    width: 1200,
    height: 600,
    bytes: 4096,
    altText,
    crop: null,
    focalPoint,
  };
}

const text = (value: string, marks?: readonly JsonObject[]): JsonObject =>
  marks === undefined ? { type: "text", text: value } : { type: "text", text: value, marks };
const paragraph = (...content: JsonObject[]): JsonObject => ({ type: "paragraph", content });
const item = (...content: JsonObject[]): JsonObject => ({ type: "list_item", content });

/** Every block and mark the grammar has, with markup-shaped text to escape. */
export const RICH_TEXT_DOCUMENT: JsonObject = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 2 }, content: [text("Why <script>alert(1)</script> us")] },
    paragraph(
      text("Plain & <b>simple</b> "),
      text("bold", [{ type: "bold" }]),
      text(" "),
      text("italic", [{ type: "italic" }]),
      text(" "),
      text("both", [{ type: "bold" }, { type: "italic" }]),
      text(" "),
      text("the team", [
        { type: "link", destination: { kind: "internal", pageId: IDS.aboutPage, fragment: "team" }, target: "same_window" },
      ]),
      text(" "),
      text("brochure", [
        { type: "bold" },
        { type: "link", destination: { kind: "external", url: "https://example.com/a?b=1&c=2" }, target: "new_window" },
      ]),
    ),
    { type: "heading", attrs: { level: 3 }, content: [text("Lists")] },
    { type: "bullet_list", content: [item(paragraph(text("one"))), item(paragraph(text("two")))] },
    { type: "ordered_list", content: [item(paragraph(text("first")), paragraph(text("second para")))] },
    {
      type: "blockquote",
      content: [
        paragraph(
          text("mail", [{ type: "link", destination: { kind: "email", address: "hello@example.com" }, target: "same_window" }]),
          text(" or "),
          text("call", [{ type: "link", destination: { kind: "phone", number: "+15555550100" }, target: "same_window" }]),
        ),
      ],
    },
  ],
};

function addAboutPage(contract: JsonObject, documents: Map<string, JsonObject>): void {
  const seo = contract.internalSeo as JsonObject;
  const home = objects(seo.pages)[0] as JsonObject;
  const homeMetadata = home.metadata as JsonObject;
  const protectedIds: Record<string, string> = {
    [homeMetadata.title as string]: IDS.aboutTitle,
    [homeMetadata.description as string]: IDS.aboutDescription,
    [homeMetadata.canonical as string]: IDS.aboutCanonical,
    [homeMetadata.indexing as string]: IDS.aboutIndexing,
  };
  const clones = objects(seo.protectedFields)
    .filter((field) => protectedIds[field.id as string] !== undefined)
    .map((field) => ({
      ...field,
      id: protectedIds[field.id as string],
      resolver: { ...(field.resolver as JsonObject), path: ABOUT },
      usages: usage(IDS.aboutPage),
    }));
  seo.protectedFields = [...objects(seo.protectedFields), ...clones];
  seo.pages = [
    ...objects(seo.pages),
    {
      ...home,
      pageId: IDS.aboutPage,
      intent: { ...(home.intent as JsonObject), purpose: "about", locations: [] },
      metadata: {
        title: IDS.aboutTitle,
        description: IDS.aboutDescription,
        canonical: IDS.aboutCanonical,
        indexing: IDS.aboutIndexing,
        social: { title: IDS.aboutTitle, description: IDS.aboutDescription, image: null },
      },
      headingOutline: [{ fieldId: IDS.aboutHeading, semanticLevel: 1 }],
      jsonLd: [],
      primaryImageAssetSlotId: null,
    },
  ];
  contract.pages = [
    ...objects(contract.pages),
    {
      id: IDS.aboutPage,
      presentation: presentation("About", 2),
      route: { kind: "static", path: "/about" },
      sections: [
        {
          id: IDS.aboutSection,
          presentation: presentation("About", 1),
          fields: [
            {
              ...pageField(IDS.aboutHeading, "/hero/title", 1, {
                type: "heading_text",
                capabilities: ["text.edit"],
                semanticLevel: 1,
                constraints: { minLength: 1, maxLength: 100, newlines: "forbid" },
              }),
              resolver: resolver(ABOUT, "/hero/title"),
              usages: usage(IDS.aboutPage),
            },
          ],
        },
      ],
    },
  ];
  const homeSeo = (documents.get(HOME) as JsonObject).seo as JsonObject;
  documents.set(ABOUT, {
    hero: { title: "About us" },
    seo: { ...homeSeo, title: "About title", description: "About description", canonical: "https://todo.example.com/about" },
  });
}

function addReaderFields(contract: JsonObject, home: JsonObject): void {
  const [homePage] = objects(contract.pages);
  (homePage as JsonObject).sections = [
    ...objects((homePage as JsonObject).sections),
    {
      id: IDS.readersSection,
      presentation: presentation("Readers", 9),
      fields: [
        linkField(IDS.internalLink, "/links/internal", 1),
        linkField(IDS.homeLink, "/links/home", 2),
        linkField(IDS.externalLink, "/links/external", 3),
        linkField(IDS.emailLink, "/links/email", 4),
        linkField(IDS.phoneLink, "/links/phone", 5),
        pageField(IDS.body, "/body", 6, {
          type: "rich_text",
          capabilities: ["text.edit", "rich_text.mark.bold", "rich_text.mark.italic", "rich_text.link.edit"],
          constraints: {
            maxCharacters: 5000,
            maxNodes: 200,
            allowedBlocks: ["paragraph", "heading", "bullet_list", "ordered_list", "blockquote"],
            allowedMarks: ["bold", "italic"],
            allowLinks: true,
            allowedExternalHosts: ["example.com"],
            allowedTargets: ["same_window", "new_window"],
          },
        }),
        imageField(IDS.fixedImage, "/images/fixed", 7, IDS.fixedSlot),
        imageField(IDS.decorativeImage, "/images/decorative", 8, IDS.decorativeSlot),
      ],
    },
  ];
  contract.assets = [
    ...objects(contract.assets),
    slot(IDS.fixedSlot, { kind: "fixed_alt", altText: "Company logo" }),
    slot(IDS.decorativeSlot, { kind: "decorative" }),
  ];
  home.links = {
    internal: { label: "Meet the team", destination: { kind: "internal", pageId: IDS.aboutPage, fragment: "team" }, target: "same_window" },
    home: { label: "Home", destination: { kind: "internal", pageId: IDS.homePage, fragment: null }, target: "same_window" },
    external: { label: "Brochure", destination: { kind: "external", url: "https://example.com/brochure.pdf?x=1&y=2" }, target: "new_window" },
    email: { label: "Email us", destination: { kind: "email", address: "hello@example.com" }, target: "same_window" },
    phone: { label: "Call us", destination: { kind: "phone", number: "+15555550100" }, target: "same_window" },
  };
  home.body = RICH_TEXT_DOCUMENT;
  home.images = {
    fixed: imageValue("public/managed-site-cms/logo.png", null, null),
    decorative: imageValue("public/managed-site-cms/texture.webp", "", { x: 0.25, y: 0.75 }),
  };
}

function addEditableSeo(contract: JsonObject, home: JsonObject): void {
  const [homePage] = objects(contract.pages);
  (homePage as JsonObject).sections = [
    ...objects((homePage as JsonObject).sections),
    {
      id: IDS.searchSection,
      presentation: presentation("Search & sharing", 10),
      fields: [
        seoTextField(IDS.seoTitle, "seo_title", 1),
        seoTextField(IDS.seoDescription, "seo_description", 2),
        imageField(IDS.shareImage, "/meta/image", 3, IDS.shareSlot),
      ],
    },
  ];
  contract.assets = [...objects(contract.assets), slot(IDS.shareSlot, { kind: "informative" })];
  const [homeSeo] = objects((contract.internalSeo as JsonObject).pages);
  const metadata = (homeSeo as JsonObject).metadata as JsonObject;
  (homeSeo as JsonObject).metadata = {
    ...metadata,
    title: IDS.seoTitle,
    description: IDS.seoDescription,
    social: { title: IDS.seoTitle, description: IDS.seoDescription, image: IDS.shareSlot, imageFieldId: IDS.shareImage },
  };
  home.meta = {
    title: "Managed title",
    description: "Managed description",
    image: imageValue("public/managed-site-cms/share.png", "Share card", null),
  };
}

/** The FAQ gains a link per item, and the customer has put the second item first. */
function reorderCollection(contract: JsonObject, home: JsonObject): void {
  const [collection] = objects(contract.collections);
  (collection as JsonObject).itemFields = [
    ...objects((collection as JsonObject).itemFields),
    {
      id: IDS.itemLink,
      type: "link",
      classification: "customer_editable",
      capabilities: LINK_CAPABILITIES,
      itemPointer: "/link",
      presentation: presentation("Item link", 3),
      constraints: LINK_CONSTRAINTS,
    },
  ];
  const faq = home.faq as JsonObject;
  faq.order = { orderedItemIds: [IDS.secondItem, IDS.firstItem] };
  const [first, second] = objects(faq.items);
  (first as JsonObject).link = {
    label: "First",
    destination: { kind: "external", url: "https://example.com/first" },
    target: "new_window",
  };
  (second as JsonObject).link = {
    label: "Second",
    destination: { kind: "internal", pageId: IDS.aboutPage, fragment: null },
    target: "same_window",
  };
}

function protectedItemField(id: string, valueType: string, semantic: string, itemPointer: string): JsonObject {
  return {
    id,
    type: "internal_protected",
    classification: "internal_protected",
    capabilities: [],
    valueType,
    semantic,
    itemPointer,
    presentation: presentation(semantic, 1),
  };
}

/**
 * A generated page, /services/[slug], over a collection of its own: the one
 * route shape whose pageId names no single URL, which a link may still name.
 */
function addGeneratedPage(contract: JsonObject, home: JsonObject): void {
  const seo = contract.internalSeo as JsonObject;
  const homeSeo = objects(seo.pages)[0] as JsonObject;
  contract.collections = [
    ...objects(contract.collections),
    {
      id: IDS.services,
      presentation: presentation("Services", 2),
      resolver: resolver(HOME, "/services/items"),
      itemIdPointer: "/id",
      itemIdPolicy: "server_minted",
      minItems: 0,
      maxItems: 10,
      itemFields: [
        protectedItemField(IDS.serviceSlug, "string", "route.slug", "/slug"),
        {
          id: IDS.serviceName,
          type: "heading_text",
          classification: "customer_editable",
          capabilities: ["text.edit"],
          itemPointer: "/name",
          presentation: presentation("Name", 2),
          semanticLevel: 1,
          constraints: { minLength: 1, maxLength: 100, newlines: "forbid" },
        },
        protectedItemField(IDS.serviceTitle, "string", "seo.title", "/seo/title"),
        protectedItemField(IDS.serviceDescription, "string", "seo.description", "/seo/description"),
        protectedItemField(IDS.serviceCanonical, "url", "seo.canonical", "/seo/canonical"),
        protectedItemField(IDS.serviceIndexing, "indexing_directives", "seo.indexing", "/seo/indexing"),
      ],
      uniqueness: [{ fieldIds: [IDS.serviceSlug], comparison: "exact" }],
      deletion: { whenReferenced: "restrict", restorable: true },
    },
  ];
  const [homePage] = objects(contract.pages);
  const [firstSection] = objects((homePage as JsonObject).sections);
  (firstSection as JsonObject).fields = [
    ...objects((firstSection as JsonObject).fields),
    pageField(IDS.servicesOrder, "/services/order", 9, {
      type: "collection",
      capabilities: ["collection.reorder", "collection.add", "collection.remove"],
      collectionId: IDS.services,
    }),
  ];
  contract.pages = [
    ...objects(contract.pages),
    {
      id: IDS.servicePage,
      presentation: presentation("Service", 3),
      route: { kind: "generated", pattern: "/services/[slug]", collectionId: IDS.services, routeKeyFieldId: IDS.serviceSlug },
      sections: [],
    },
  ];
  seo.generatedPages = [
    {
      pageId: IDS.servicePage,
      collectionId: IDS.services,
      intent: { purpose: "service", primaryEntity: IDS.serviceTitle, services: [IDS.serviceTitle], locations: [] },
      metadata: {
        title: IDS.serviceTitle,
        description: IDS.serviceDescription,
        canonical: IDS.serviceCanonical,
        indexing: IDS.serviceIndexing,
        social: { title: IDS.serviceTitle, description: IDS.serviceDescription, imageFieldId: null },
      },
      headingOutline: [{ fieldId: IDS.serviceName, semanticLevel: 1 }],
      jsonLd: [],
      breadcrumbParentPageId: null,
      internalLinks: { requiredPageIds: [], minimumInboundLinks: 0 },
      sitemap: { included: true, changeFrequency: "monthly", priority: 0.5 },
      primaryImageFieldId: null,
      performanceBudget: homeSeo.performanceBudget,
    },
  ];
  const homeSeoValues = home.seo as JsonObject;
  home.services = {
    order: { orderedItemIds: [IDS.roofing] },
    items: [
      {
        id: IDS.roofing,
        slug: "roofing",
        name: "Roofing",
        seo: { ...homeSeoValues, title: "Roofing", description: "Roofing services", canonical: "https://todo.example.com/services/roofing" },
      },
    ],
  };
}

export function runtimeSite(): RuntimeSite {
  const contract = readJson("managed-site.contract.json");
  const home = readJson("pages/home.json");
  const documents = new Map<string, JsonObject>([
    [HOME, home],
    [SITE, readJson("site.json")],
  ]);
  addAboutPage(contract, documents);
  addReaderFields(contract, home);
  addEditableSeo(contract, home);
  reorderCollection(contract, home);
  addGeneratedPage(contract, home);
  // Every layer shares constants by reference; a variant must own its copy.
  return structuredClone({ contract, documents });
}

export function homeDocument(site: RuntimeSite): JsonObject {
  return site.documents.get(HOME) as JsonObject;
}

/**
 * Writes the site and its generated runtime into a scratch repository whose
 * `node_modules` is this workspace's, so the runtime resolves the contract
 * package, React and Next exactly as a converted site does. Returns the path of
 * the runtime module.
 */
export function writeRuntimeSite(site: RuntimeSite, probe = ""): string {
  const root = mkdtempSync(join(tmpdir(), "managed-site-runtime-"));
  symlinkSync(join(REPOSITORY_ROOT, "node_modules"), join(root, "node_modules"), "dir");
  const write = (path: string, value: unknown): void => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), typeof value === "string" ? value : JSON.stringify(value, null, 2));
  };
  // ESM, as a Next build treats it: the contract package exports `import` only.
  write("package.json", { private: true, type: "module" });
  // The generator reads only which documents there are, never their values.
  const paths = new Map([...site.documents.keys()].map((path) => [path, null]));
  const runtime = runtimeModule({ sourceDocuments: paths }, "src/content");
  write(join("src/content", CONTRACT_FILE), site.contract);
  for (const [path, value] of site.documents) write(path, value);
  // A test may append a probe exporting module internals; a site never has one.
  write(runtime.path, runtime.text + probe);
  return join(root, runtime.path);
}

type Fields = Readonly<Record<string, unknown>>;

/** The runtime's exports, as a converted site's components see them. */
export interface GeneratedRuntime {
  managedText(fieldId: string): { readonly value: string; readonly attributes: Fields };
  managedItem(collectionId: string, index: number): { value(fieldId: string): string };
  managedOrder(collectionId: string): readonly string[];
  managedItemById(collectionId: string, itemId: string): {
    readonly itemId: string;
    value(fieldId: string): string;
    attributes(fieldId: string): Fields;
    link(fieldId: string): Fields;
    image(fieldId: string): Fields;
    richText(fieldId: string): { readonly value: unknown; readonly attributes: Fields };
  };
  managedLink(fieldId: string): Fields;
  resolveManagedLink(value: unknown): Fields;
  resolveManagedImage(assetSlotId: string, value: unknown): Fields;
  managedImage(fieldId: string): Fields;
  managedRichTextBlocks(fieldId: string): { readonly value: unknown; readonly attributes: Fields };
  renderManagedRichText(document: unknown): unknown;
  /** #104's formatted-block reader: one paragraph or heading. */
  managedRichText(fieldId: string, templates: Readonly<Record<string, unknown>>): { readonly content: unknown };
  managedImageCrop(image: Fields): { readonly frame: Fields; readonly image: Fields } | null;
  managedMetadata(pageId: string, fallback: Fields): Fields;
}

export async function loadRuntime(site: RuntimeSite): Promise<GeneratedRuntime> {
  return (await import(pathToFileURL(writeRuntimeSite(site)).href)) as GeneratedRuntime;
}
