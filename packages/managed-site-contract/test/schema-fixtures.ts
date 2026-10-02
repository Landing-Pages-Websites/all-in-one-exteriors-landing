import { mintStableId } from "../src/ids.js";

type StableKind =
  | "contract"
  | "page"
  | "section"
  | "field"
  | "collection"
  | "item"
  | "asset"
  | "alias";

const SUFFIXES: Record<StableKind, string> = {
  contract: "00000000000000000000000000",
  page: "10000000000000000000000000",
  section: "20000000000000000000000000",
  field: "30000000000000000000000000",
  collection: "40000000000000000000000000",
  item: "50000000000000000000000000",
  asset: "60000000000000000000000000",
  alias: "70000000000000000000000000",
};

export function stableId(kind: StableKind): string {
  return `${kind}_${SUFFIXES[kind]}`;
}

export function secondaryPageId(): string {
  return mintStableId("page", new Uint8Array(16).fill(1));
}

export const presentation = {
  name: "Hero title",
  description: null,
  group: "Hero",
  order: 1,
  example: null,
};

export const resolver = {
  kind: "json_pointer",
  path: "content/site.json",
  pointer: "/hero/title",
};

export const usage = { pageId: stableId("page"), itemId: null };
export const richTextParagraph = {
  type: "paragraph",
  content: [{ type: "text", text: "Trusted copy", marks: [{ type: "bold" }] }],
};

export function richTextDocument(content: readonly unknown[]): Record<string, unknown> {
  return { type: "doc", content };
}

export function linkedListDocument(): Record<string, unknown> {
  return richTextDocument([
    {
      type: "bullet_list",
      content: [
        {
          type: "list_item",
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: "Safe",
                  marks: [
                    {
                      type: "link",
                      destination: { kind: "external", url: "https://example.com/path" },
                      target: "same_window",
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ]);
}

export const invalidRichTextContent = [
  { type: "heading", level: 1, content: [] },
  { type: "html", value: "<script>alert(1)</script>" },
  { type: "embed", src: "https://example.com" },
  { ...richTextParagraph, onClick: "alert(1)" },
  {
    type: "paragraph",
    content: [{ type: "text", text: "bad", marks: [{ type: "underline" }] }],
  },
];

export const invalidLinkValues = [
  {
    label: "Unknown section",
    destination: {
      kind: "internal",
      pageId: stableId("page"),
      fragment: "admin",
    },
    target: "same_window",
  },
  {
    label: "Escalated target",
    destination: { kind: "external", url: "https://example.com" },
    target: "_top",
  },
  {
    label: "Executable",
    destination: { kind: "external", url: "javascript:alert(1)" },
    target: "same_window",
  },
  {
    label: "Control character",
    destination: { kind: "external", url: "https://example.com/\nadmin" },
    target: "same_window",
  },
];

export function richTextContentValue(url: string): Record<string, unknown> {
  return {
    fieldId: stableId("field"),
    owner: { kind: "site" },
    type: "rich_text",
    value: richTextDocument([
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "Link",
            marks: [
              {
                type: "link",
                destination: { kind: "external", url },
                target: "same_window",
              },
            ],
          },
        ],
      },
    ]),
  };
}

export function linkContentValue(value: unknown): Record<string, unknown> {
  return {
    fieldId: stableId("field"),
    owner: { kind: "site" },
    type: "link",
    value,
  };
}

export function contentDocument(): Record<string, unknown> {
  return {
    schemaVersion: "1.0",
    values: [
      {
        fieldId: stableId("field"),
        owner: { kind: "page", pageId: stableId("page") },
        type: "plain_text",
        value: "Hello",
      },
    ],
    assetManifest: [
      {
        assetSlotId: stableId("asset"),
        path: "public/images/hero.webp",
        sha256: "a".repeat(64),
        mimeType: "image/webp",
        width: 1_600,
        height: 800,
        bytes: 500_000,
      },
    ],
  };
}

export function internalContentValue(): Record<string, unknown> {
  return {
    fieldId: stableId("field"),
    owner: { kind: "site" },
    type: "internal_protected",
    valueType: "json",
    value: "schema-owned scalar",
  };
}

function renderedFieldBase(): Record<string, unknown> {
  return {
    id: stableId("field"),
    scope: "page",
    classification: "customer_editable",
    resolver,
    usages: [usage],
    presentation,
  };
}

export function plainTextField(): Record<string, unknown> {
  return {
    ...renderedFieldBase(),
    type: "plain_text",
    capabilities: ["text.edit"],
    semantic: "body",
    constraints: { minLength: 1, maxLength: 120, newlines: "forbid" },
  };
}

export function headingTextField(): Record<string, unknown> {
  return {
    ...renderedFieldBase(),
    type: "heading_text",
    capabilities: ["text.edit"],
    semanticLevel: 2,
    constraints: { minLength: 1, maxLength: 80, newlines: "forbid" },
  };
}

export function richTextField(): Record<string, unknown> {
  return {
    ...renderedFieldBase(),
    type: "rich_text",
    capabilities: [
      "text.edit",
      "rich_text.mark.bold",
      "rich_text.mark.italic",
      "rich_text.link.edit",
    ],
    constraints: {
      maxCharacters: 2_000,
      maxNodes: 100,
      allowedBlocks: ["paragraph", "bullet_list", "ordered_list"],
      allowedMarks: ["bold", "italic"],
      allowLinks: true,
      allowedExternalHosts: ["example.com"],
      allowedTargets: ["same_window", "new_window"],
    },
  };
}

export function linkField(): Record<string, unknown> {
  return {
    ...renderedFieldBase(),
    type: "link",
    capabilities: [
      "link.label.edit",
      "link.destination.edit",
      "link.target.edit",
    ],
    constraints: {
      labelConstraints: { minLength: 1, maxLength: 80, newlines: "forbid" },
      authority: "internal_or_external",
      allowedSchemes: ["https", "mailto", "tel"],
      allowedExternalHosts: ["example.com"],
      fragmentPolicy: "declared",
      allowedFragments: ["contact"],
      allowedTargets: ["same_window", "new_window"],
    },
  };
}

export function imageField(): Record<string, unknown> {
  return {
    ...renderedFieldBase(),
    type: "image",
    capabilities: [
      "image.upload",
      "image.crop",
      "image.focal_point.edit",
      "image.alt.edit",
    ],
    assetSlotId: stableId("asset"),
  };
}

export function collectionField(): Record<string, unknown> {
  return {
    ...renderedFieldBase(),
    type: "collection",
    capabilities: [
      "collection.reorder",
      "collection.add",
      "collection.remove",
    ],
    collectionId: stableId("collection"),
  };
}

export function assetSlot(): Record<string, unknown> {
  return {
    id: stableId("asset"),
    presentation,
    semantics: { kind: "informative" },
    acceptedMimeTypes: ["image/jpeg", "image/png"],
    outputMimeTypes: ["image/webp", "image/avif"],
    minWidth: 800,
    maxWidth: 2_400,
    minHeight: 400,
    maxHeight: 1_200,
    aspectRatios: [{ width: 2, height: 1 }],
    cropPolicy: "optional",
    focalPointPolicy: "optional",
    maxBytes: 2_000_000,
  };
}

export function imageValue(): Record<string, unknown> {
  return {
    path: "public/images/hero.webp",
    sha256: "a".repeat(64),
    mimeType: "image/webp",
    width: 1_600,
    height: 800,
    bytes: 500_000,
    altText: "A clean rain gutter",
    crop: { x: 0, y: 0, width: 1, height: 1 },
    focalPoint: { x: 0.5, y: 0.5 },
  };
}

export function collectionDescriptor(): Record<string, unknown> {
  return {
    id: stableId("collection"),
    presentation,
    resolver: { ...resolver, pointer: "/services" },
    itemIdPointer: "/id",
    itemIdPolicy: "server_minted",
    minItems: 1,
    maxItems: 20,
    itemFields: [
      {
        id: stableId("field"),
        type: "plain_text",
        classification: "customer_editable",
        capabilities: ["text.edit"],
        itemPointer: "/title",
        presentation,
        semantic: "body",
        constraints: { minLength: 1, maxLength: 80, newlines: "forbid" },
      },
    ],
    uniqueness: [
      { fieldIds: [stableId("field")], comparison: "case_folded" },
    ],
    deletion: { whenReferenced: "restrict", restorable: true },
  };
}

export function internalProtectedField(): Record<string, unknown> {
  return {
    id: stableId("field"),
    scope: "site",
    type: "internal_protected",
    classification: "internal_protected",
    capabilities: [],
    valueType: "string",
    semantic: "seo.title",
    resolver: { ...resolver, pointer: "/seo/title" },
    usages: [usage],
    presentation,
  };
}

const SEO_FIELD_ID = stableId("field");
const SEO_DESCRIPTOR = {
    protectedFields: [internalProtectedField()],
    businessIdentity: {
      legalName: SEO_FIELD_ID,
      displayName: SEO_FIELD_ID,
      telephone: SEO_FIELD_ID,
      postalAddress: SEO_FIELD_ID,
      email: null,
      geo: null,
      openingHours: null,
      sameAs: null,
    },
    pages: [
      {
        pageId: stableId("page"),
        intent: {
          purpose: "home",
          primaryEntity: SEO_FIELD_ID,
          services: [],
          locations: [],
        },
        metadata: {
          title: SEO_FIELD_ID,
          description: SEO_FIELD_ID,
          canonical: SEO_FIELD_ID,
          indexing: SEO_FIELD_ID,
          social: { title: null, description: null, image: null },
        },
        headingOutline: [{ fieldId: SEO_FIELD_ID, semanticLevel: 1 }],
        jsonLd: [
          {
            schemaType: "LocalBusiness",
            required: true,
            sourceFieldIds: [SEO_FIELD_ID],
            requiredOutputProperties: ["name", "telephone"],
          },
        ],
        breadcrumbParentPageId: null,
        internalLinks: { requiredPageIds: [], minimumInboundLinks: 0 },
        sitemap: {
          included: true,
          changeFrequency: "monthly",
          priority: 1,
        },
        primaryImageAssetSlotId: stableId("asset"),
        performanceBudget: {
          maxLcpMilliseconds: 2_500,
          maxCls: 0.1,
          maxInpMilliseconds: 200,
          maxPageBytes: 1_500_000,
        },
      },
    ],
    generatedPages: [],
    redirects: [
      {
        fromPath: "/old",
        destination: { kind: "page", pageId: stableId("page") },
        status: 301,
        preserveQuery: true,
      },
    ],
};

export function textConstraints(): Record<string, unknown> {
  return { minLength: 0, maxLength: 160, newlines: "forbid" };
}

export function richTextConstraints(): Record<string, unknown> {
  return {
    maxCharacters: 2_000,
    maxNodes: 200,
    allowedBlocks: ["paragraph"],
    allowedMarks: [],
    allowLinks: false,
    allowedExternalHosts: [],
    allowedTargets: [],
  };
}

export function collectionBounds(): Record<string, unknown> {
  return { minItems: 1, maxItems: 24 };
}

export function sitemapPolicy(): Record<string, unknown> {
  return { included: true, changeFrequency: "monthly", priority: 1 };
}

export function performanceBudget(): Record<string, unknown> {
  return {
    maxLcpMilliseconds: 2_500,
    maxCls: 0.1,
    maxInpMilliseconds: 200,
    maxPageBytes: 1_500_000,
  };
}

export function seoDescriptor(): Record<string, unknown> {
  return structuredClone(SEO_DESCRIPTOR);
}

const MANAGED_SITE_CONTRACT = {
    schemaVersion: "1.0",
    contractId: stableId("contract"),
    adapter: { kind: "nextjs", adapterVersion: "1.0" },
    bridge: {
      reviewProtocol: 1,
      editProtocol: 2,
      annotationVersion: 1,
      delivery: {
        version: "v10",
        src: "https://app.gomega.ai/review-bridge/v10/review-bridge.js",
        integrity: `sha384-${"a".repeat(64)}`,
        crossOrigin: "anonymous",
        load: "head_defer",
      },
      framing: "authenticated_preview_gateway",
    },
    pages: [
      {
        id: stableId("page"),
        presentation,
        route: { kind: "static", path: "/" },
        sections: [
          {
            id: stableId("section"),
            presentation,
            fields: [
              plainTextField(),
              richTextField(),
              linkField(),
              imageField(),
              collectionField(),
            ],
          },
        ],
      },
    ],
    collections: [collectionDescriptor()],
    assets: [assetSlot()],
    internalSeo: SEO_DESCRIPTOR,
    atomicAliasGroups: [
      { id: stableId("alias"), fieldIds: [stableId("field")] },
    ],
    tombstonedIds: [],
};

export function managedSiteContract(): Record<string, unknown> {
  return structuredClone(MANAGED_SITE_CONTRACT);
}
