import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  parseManagedSiteContentDocument,
  parseManagedSiteContractV1,
  validateManagedSiteContentDocumentJsonSchema,
  validateManagedSiteContractV1JsonSchema,
} from "../src/index.js";
import {
  contentDocument,
  imageValue,
  linkContentValue,
  managedSiteContract,
  richTextContentValue,
  richTextDocument,
  secondaryPageId,
  stableId,
} from "./schema-fixtures.js";

type JsonObject = Record<string, unknown>;
type Mutate = (input: JsonObject) => void;

interface DifferentialCase {
  readonly name: string;
  readonly input: () => JsonObject;
  readonly valid: boolean;
}

function objectAt(
  input: JsonObject,
  path: readonly (string | number)[],
): JsonObject {
  let current: unknown = input;
  for (const key of path) {
    assert.notEqual(current, null);
    assert.equal(typeof current, "object");
    current = (current as Record<string | number, unknown>)[key];
  }
  assert.notEqual(current, null);
  assert.equal(typeof current, "object");
  assert.equal(Array.isArray(current), false);
  return current as JsonObject;
}

function changed(create: () => JsonObject, mutate: Mutate): () => JsonObject {
  return () => {
    const input = create();
    mutate(input);
    return input;
  };
}

function invalidContract(name: string, mutate: Mutate): DifferentialCase {
  return { name, input: changed(managedSiteContract, mutate), valid: false };
}

function invalidContent(name: string, mutate: Mutate): DifferentialCase {
  return { name, input: changed(contentDocument, mutate), valid: false };
}

function contentWithValue(value: JsonObject): JsonObject {
  const document = contentDocument();
  document.values = [value];
  return document;
}

/**
 * A rich-text value whose single text node carries exactly the given `marks`
 * property, so a case can vary that property and nothing else. `undefined` omits
 * it, which is the canonical spelling for unmarked text.
 */
function textMarksValue(marks: unknown): JsonObject {
  const text: JsonObject = { type: "text", text: "Prose" };
  if (marks !== undefined) text.marks = marks;
  return {
    fieldId: stableId("field"),
    owner: { kind: "site" },
    type: "rich_text",
    value: richTextDocument([{ type: "paragraph", content: [text] }]),
  };
}

function internalValue(valueType: string, value: unknown): JsonObject {
  return {
    fieldId: stableId("field"),
    owner: { kind: "site" },
    type: "internal_protected",
    valueType,
    value,
  };
}

function nestedValue(depth: number): unknown {
  let value: unknown = "leaf";
  for (let index = 0; index < depth; index += 1) value = { nested: value };
  return value;
}

function objectWithOwnKey(key: string, value: unknown): JsonObject {
  const result: JsonObject = {};
  Object.defineProperty(result, key, { enumerable: true, value });
  return result;
}

function astralStringWithCodeUnits(length: number): string {
  assert.ok(length >= 2);
  const value = `${"x".repeat(length - 2)}😀`;
  assert.equal(value.length, length);
  return value;
}

function astralStringWithCodePoints(count: number): string {
  const value = `${"x".repeat(count - 1)}😀`;
  assert.equal([...value].length, count);
  return value;
}

function boundedContractStringCase(
  name: string,
  path: readonly (string | number)[],
  length: number,
  valid: boolean,
): DifferentialCase {
  return {
    name,
    input: changed(managedSiteContract, (input) => {
      const key = path.at(-1);
      if (key === undefined)
        throw new Error("Bounded-string path must not be empty");
      objectAt(input, path.slice(0, -1))[key] =
        astralStringWithCodeUnits(length);
    }),
    valid,
  };
}

const JSON_LD_PATH = ["internalSeo", "pages", 0, "jsonLd", 0] as const;

const ASTRAL_CONTRACT_BOUNDARIES: readonly DifferentialCase[] = [
  ...[159, 160, 161].map((length) =>
    boundedContractStringCase(
      `JSON-LD schema type astral boundary ${length}`,
      [...JSON_LD_PATH, "schemaType"],
      length,
      length <= 160,
    ),
  ),
  ...[159, 160, 161].map((length) => ({
    name: `JSON-LD output property astral boundary ${length}`,
    input: changed(managedSiteContract, (input) => {
      objectAt(input, JSON_LD_PATH).requiredOutputProperties = [
        astralStringWithCodeUnits(length),
      ];
    }),
    valid: length <= 160,
  })),
  ...[255, 256, 257].map((length) =>
    boundedContractStringCase(
      `protected semantic astral boundary ${length}`,
      ["internalSeo", "protectedFields", 0, "semantic"],
      length,
      length <= 256,
    ),
  ),
];

const ADJACENT_BOUNDED_CONTRACT_CASES: readonly DifferentialCase[] = [
  boundedContractStringCase(
    "presentation name astral overflow",
    ["pages", 0, "presentation", "name"],
    161,
    false,
  ),
  boundedContractStringCase(
    "presentation description astral overflow",
    ["pages", 0, "presentation", "description"],
    1_001,
    false,
  ),
  boundedContractStringCase(
    "presentation group astral overflow",
    ["pages", 0, "presentation", "group"],
    161,
    false,
  ),
  invalidContract("fixed image alt astral overflow", (input) => {
    objectAt(input, ["assets", 0]).semantics = {
      kind: "fixed_alt",
      altText: astralStringWithCodeUnits(2_001),
    };
  }),
];

const CONTRACT_CASES: readonly DifferentialCase[] = [
  { name: "valid contract", input: managedSiteContract, valid: true },
  {
    name: "valid unknown business postal address",
    input: changed(managedSiteContract, (input) => {
      objectAt(input, ["internalSeo", "businessIdentity"]).postalAddress = null;
    }),
    valid: true,
  },
  {
    name: "valid generated route",
    input: changed(managedSiteContract, (input) => {
      objectAt(input, ["pages", 0]).route = {
        kind: "generated",
        pattern: "/services/[slug]",
        collectionId: stableId("collection"),
        routeKeyFieldId: stableId("field"),
      };
    }),
    valid: true,
  },
  invalidContract("unknown root key", (input) => {
    input.extra = true;
  }),
  invalidContract("prototype-shaped root key", (input) => {
    Object.defineProperty(input, "__proto__", {
      enumerable: true,
      value: true,
    });
  }),
  invalidContract("unknown nested union key", (input) => {
    objectAt(input, ["pages", 0, "route"]).extra = true;
  }),
  invalidContract("wrong route discriminant", (input) => {
    objectAt(input, ["pages", 0, "route"]).kind = "dynamic";
  }),
  invalidContract("invalid stable ID", (input) => {
    input.contractId = "contract_home";
  }),
  invalidContract("repository traversal", (input) => {
    objectAt(input, ["pages", 0, "sections", 0, "fields", 0, "resolver"]).path =
      "../secret.webp";
  }),
  invalidContract("URI-fragment JSON pointer", (input) => {
    objectAt(input, [
      "pages",
      0,
      "sections",
      0,
      "fields",
      0,
      "resolver",
    ]).pointer = "#/title";
  }),
  invalidContract("noncanonical static route", (input) => {
    objectAt(input, ["pages", 0, "route"]).path = "/../admin";
  }),
  invalidContract("encoded generated route ambiguity", (input) => {
    objectAt(input, ["pages", 0]).route = {
      kind: "generated",
      pattern: "/services/%2e/[slug]",
      collectionId: stableId("collection"),
      routeKeyFieldId: stableId("field"),
    };
  }),
  invalidContract("invalid fragment declaration", (input) => {
    objectAt(input, [
      "pages",
      0,
      "sections",
      0,
      "fields",
      2,
      "constraints",
    ]).allowedFragments = ["#admin"];
  }),
  invalidContract("old bridge version", (input) => {
    objectAt(input, ["bridge", "delivery"]).version = "v3";
  }),
  invalidContract("alternate bridge source", (input) => {
    objectAt(input, ["bridge", "delivery"]).src =
      "https://evil.example/review-bridge.js";
  }),
  invalidContract("invalid bridge integrity", (input) => {
    objectAt(input, ["bridge", "delivery"]).integrity = "sha384-short";
  }),
  invalidContract("capability outside field type", (input) => {
    objectAt(input, ["pages", 0, "sections", 0, "fields", 0]).capabilities = [
      "image.upload",
    ];
  }),
  invalidContract("customer field without capabilities", (input) => {
    objectAt(input, ["pages", 0, "sections", 0, "fields", 0]).capabilities = [];
  }),
  invalidContract("field without ownership scope", (input) => {
    delete objectAt(input, ["pages", 0, "sections", 0, "fields", 0]).scope;
  }),
  invalidContract("unknown field ownership scope", (input) => {
    objectAt(input, ["pages", 0, "sections", 0, "fields", 0]).scope = "global";
  }),
  invalidContract("page-owned field spanning pages", (input) => {
    objectAt(input, ["pages", 0, "sections", 0, "fields", 0]).usages = [
      { pageId: stableId("page"), itemId: null },
      { pageId: secondaryPageId(), itemId: null },
    ];
  }),
  {
    name: "site-owned field spanning pages",
    input: changed(managedSiteContract, (input) => {
      const field = objectAt(input, ["pages", 0, "sections", 0, "fields", 0]);
      field.scope = "site";
      field.usages = [
        { pageId: stableId("page"), itemId: null },
        { pageId: secondaryPageId(), itemId: null },
      ];
    }),
    valid: true,
  },
  invalidContract("protected field without ownership scope", (input) => {
    delete objectAt(input, ["internalSeo", "protectedFields", 0]).scope;
  }),
  invalidContract("page-owned protected field spanning pages", (input) => {
    const field = objectAt(input, ["internalSeo", "protectedFields", 0]);
    field.scope = "page";
    field.usages = [
      { pageId: stableId("page"), itemId: null },
      { pageId: secondaryPageId(), itemId: null },
    ];
  }),
  {
    name: "site-owned protected field spanning pages",
    input: changed(managedSiteContract, (input) => {
      const field = objectAt(input, ["internalSeo", "protectedFields", 0]);
      field.scope = "site";
      field.usages = [
        { pageId: stableId("page"), itemId: null },
        { pageId: secondaryPageId(), itemId: null },
      ];
    }),
    valid: true,
  },
  invalidContract("rich mark capability outside policy", (input) => {
    objectAt(input, [
      "pages",
      0,
      "sections",
      0,
      "fields",
      1,
      "constraints",
    ]).allowedMarks = ["italic"];
  }),
  invalidContract("duplicate rich policy", (input) => {
    objectAt(input, [
      "pages",
      0,
      "sections",
      0,
      "fields",
      1,
      "constraints",
    ]).allowedTargets = ["same_window", "same_window"];
  }),
  invalidContract("link label range exceeds content maximum", (input) => {
    objectAt(input, [
      "pages",
      0,
      "sections",
      0,
      "fields",
      2,
      "constraints",
      "labelConstraints",
    ]).maxLength = 2_001;
  }),
  invalidContract("forbidden fragment declaration", (input) => {
    const constraints = objectAt(input, [
      "pages",
      0,
      "sections",
      0,
      "fields",
      2,
      "constraints",
    ]);
    constraints.fragmentPolicy = "forbid";
    constraints.allowedFragments = ["contact"];
  }),
  invalidContract("conflicting asset dimensions", (input) => {
    objectAt(input, ["assets", 0]).minWidth = 3_000;
  }),
  invalidContract("duplicate equivalent aspect ratios", (input) => {
    objectAt(input, ["assets", 0]).aspectRatios = [
      { width: 2, height: 1 },
      { width: 4, height: 2 },
    ];
  }),
  invalidContract("collection minimum exceeds maximum", (input) => {
    objectAt(input, ["collections", 0]).minItems = 21;
  }),
  invalidContract("duplicate collection uniqueness key", (input) => {
    objectAt(input, ["collections", 0, "uniqueness", 0]).fieldIds = [
      stableId("field"),
      stableId("field"),
    ];
  }),
  invalidContract("presentation example exceeds depth eight", (input) => {
    objectAt(input, ["pages", 0, "presentation"]).example = nestedValue(9);
  }),
  invalidContract(
    "prototype-shaped key cannot hide presentation depth",
    (input) => {
      objectAt(input, ["pages", 0, "presentation"]).example = objectWithOwnKey(
        "__proto__",
        nestedValue(8),
      );
    },
  ),
  invalidContract("unsafe SEO redirect URL", (input) => {
    objectAt(input, ["internalSeo", "redirects", 0]).destination = {
      kind: "external",
      url: "http://example.com/old",
    };
  }),
  invalidContract("invalid SEO outline level", (input) => {
    objectAt(input, [
      "internalSeo",
      "pages",
      0,
      "headingOutline",
      0,
    ]).semanticLevel = 7;
  }),
  ...ASTRAL_CONTRACT_BOUNDARIES,
  ...ADJACENT_BOUNDED_CONTRACT_CASES,
];

function validContentCases(): readonly DifferentialCase[] {
  return [
    { name: "valid content document", input: contentDocument, valid: true },
    {
      name: "link label of 2,000 code points, one astral (2,001 UTF-16 units)",
      input: () =>
        contentWithValue(
          linkContentValue({
            label: astralStringWithCodeUnits(2_001),
            destination: { kind: "email", address: "hello@example.com" },
            target: "same_window",
          }),
        ),
      valid: true,
    },
    {
      name: "image alt of 2,000 code points, one astral (2,001 UTF-16 units)",
      input: () =>
        contentWithValue({
          fieldId: stableId("field"),
          owner: { kind: "site" },
          type: "image",
          value: { ...imageValue(), altText: astralStringWithCodeUnits(2_001) },
        }),
      valid: true,
    },
    {
      name: "heading value",
      input: () =>
        contentWithValue({
          fieldId: stableId("field"),
          owner: { kind: "site" },
          type: "heading_text",
          value: "Heading",
        }),
      valid: true,
    },
    {
      name: "rich-text value",
      input: () =>
        contentWithValue(richTextContentValue("https://example.com/path")),
      valid: true,
    },
    // Unmarked text omits `marks`. Asserted as accepted alongside the rejections
    // below, because a schema that required the property would also make every
    // rejection here pass while breaking every unmarked run of prose.
    {
      name: "unmarked text omits marks",
      input: () => contentWithValue(textMarksValue(undefined)),
      valid: true,
    },
    {
      name: "text with one mark",
      input: () => contentWithValue(textMarksValue([{ type: "bold" }])),
      valid: true,
    },
    {
      name: "text with one of each mark kind",
      input: () =>
        contentWithValue(
          textMarksValue([
            { type: "bold" },
            { type: "italic" },
            {
              destination: { kind: "external", url: "https://example.com/x" },
              target: "same_window",
              type: "link",
            },
          ]),
        ),
      valid: true,
    },
    {
      name: "link value",
      input: () =>
        contentWithValue(
          linkContentValue({
            label: "Call",
            destination: { kind: "phone", number: "+14165551234" },
            target: "same_window",
          }),
        ),
      valid: true,
    },
    {
      name: "image value",
      input: () =>
        contentWithValue({
          fieldId: stableId("field"),
          owner: { kind: "site" },
          type: "image",
          value: imageValue(),
        }),
      valid: true,
    },
    {
      name: "collection value",
      input: () =>
        contentWithValue({
          fieldId: stableId("field"),
          owner: { kind: "site" },
          type: "collection",
          value: { orderedItemIds: [stableId("item")] },
        }),
      valid: true,
    },
    {
      name: "postal address",
      input: () =>
        contentWithValue(
          internalValue("postal_address", {
            streetAddress: "1 Main St",
            addressLocality: "Toronto",
            addressRegion: "ON",
            postalCode: "M5V 2T6",
            addressCountry: "CA",
          }),
        ),
      valid: true,
    },
    {
      name: "geo coordinates",
      input: () =>
        contentWithValue(
          internalValue("geo_coordinates", {
            latitude: 43.65,
            longitude: -79.38,
          }),
        ),
      valid: true,
    },
    {
      name: "opening hours",
      input: () =>
        contentWithValue(
          internalValue("opening_hours", {
            timeZone: "America/Toronto",
            periods: [
              {
                days: ["monday"],
                allDay: false,
                opens: "09:00",
                closes: "17:00",
              },
            ],
          }),
        ),
      valid: true,
    },
    {
      name: "indexing directives",
      input: () =>
        contentWithValue(
          internalValue("indexing_directives", {
            index: true,
            follow: true,
            archive: true,
            imageIndex: true,
            maxSnippet: -1,
            maxImagePreview: "large",
            maxVideoPreview: -1,
          }),
        ),
      valid: true,
    },
    {
      name: "opaque JSON",
      input: () =>
        contentWithValue(
          internalValue("json", { nested: [true, null, "copy"] }),
        ),
      valid: true,
    },
    {
      name: "prototype-shaped opaque JSON key",
      input: () =>
        contentWithValue(
          internalValue("json", objectWithOwnKey("__proto__", { safe: true })),
        ),
      valid: true,
    },
  ];
}

const INVALID_CONTENT_CASES: readonly DifferentialCase[] = [
  // One spelling for unmarked text. The stored blob is hashed, so a second
  // spelling of the same prose hashes differently while meaning the same thing,
  // and the writer refuses it. Each of these is a way the constraint could be
  // dropped: `minItems` removed, `optional` widened to nullable, the duplicate
  // guard lost, or the ceiling raised.
  {
    name: "text with an empty marks array",
    input: () => contentWithValue(textMarksValue([])),
    valid: false,
  },
  {
    name: "text with null marks",
    input: () => contentWithValue(textMarksValue(null)),
    valid: false,
  },
  {
    name: "text with the same mark kind twice",
    input: () =>
      contentWithValue(textMarksValue([{ type: "bold" }, { type: "bold" }])),
    valid: false,
  },
  {
    name: "text with more marks than kinds exist",
    input: () =>
      contentWithValue(
        textMarksValue([
          { type: "bold" },
          { type: "italic" },
          {
            destination: { kind: "external", url: "https://example.com/x" },
            target: "same_window",
            type: "link",
          },
          { type: "bold" },
        ]),
      ),
    valid: false,
  },
  invalidContent("unknown document key", (input) => {
    input.extra = true;
  }),
  invalidContent("unknown value key", (input) => {
    objectAt(input, ["values", 0]).extra = true;
  }),
  invalidContent("wrong value discriminant", (input) => {
    objectAt(input, ["values", 0]).type = "html";
  }),
  invalidContent("invalid field ID", (input) => {
    objectAt(input, ["values", 0]).fieldId = "field_home";
  }),
  invalidContent("unsafe manifest path", (input) => {
    objectAt(input, ["assetManifest", 0]).path = "../hero.webp";
  }),
  invalidContent("invalid manifest MIME", (input) => {
    objectAt(input, ["assetManifest", 0]).mimeType = "image/svg+xml";
  }),
  invalidContent("raw HTML rich-text node", (input) => {
    input.values = [richTextContentValue("https://example.com")];
    objectAt(input, ["values", 0, "value"]).content = [
      { type: "html", value: "<b>bad</b>" },
    ];
  }),
  invalidContent("duplicate rich-text marks", (input) => {
    input.values = [richTextContentValue("https://example.com")];
    objectAt(input, ["values", 0, "value", "content", 0, "content", 0]).marks =
      [{ type: "bold" }, { type: "bold" }];
  }),
  invalidContent("rich-text semantic node overflow", (input) => {
    const texts = Array.from({ length: 2_000 }, () => ({
      type: "text",
      text: "x",
    }));
    input.values = [
      {
        fieldId: stableId("field"),
        owner: { kind: "site" },
        type: "rich_text",
        value: {
          type: "doc",
          content: [{ type: "paragraph", content: texts }],
        },
      },
    ];
  }),
  invalidContent("executable link destination", (input) => {
    input.values = [
      linkContentValue({
        label: "Bad",
        destination: { kind: "external", url: "javascript:alert(1)" },
        target: "same_window",
      }),
    ];
  }),
  invalidContent("link label overflow", (input) => {
    input.values = [
      linkContentValue({
        label: "x".repeat(2_001),
        destination: { kind: "email", address: "hello@example.com" },
        target: "same_window",
      }),
    ];
  }),
  // Link labels and alt text count code points, as the CMS's char_length does:
  // 2,000 code points of which one is astral (2,001 UTF-16 units) is admitted,
  // 2,001 code points is not.
  invalidContent("link label astral overflow", (input) => {
    input.values = [
      linkContentValue({
        label: astralStringWithCodePoints(2_001),
        destination: { kind: "email", address: "hello@example.com" },
        target: "same_window",
      }),
    ];
  }),
  invalidContent("internal string astral overflow", (input) => {
    input.values = [internalValue("string", astralStringWithCodeUnits(10_001))];
  }),
  invalidContent("internal string-list item astral overflow", (input) => {
    input.values = [
      internalValue("string_list", [astralStringWithCodeUnits(2_049)]),
    ];
  }),
  invalidContent("postal-address string astral overflow", (input) => {
    input.values = [
      internalValue("postal_address", {
        streetAddress: astralStringWithCodeUnits(301),
        addressLocality: "Toronto",
        addressRegion: "ON",
        postalCode: "M5V 2T6",
        addressCountry: "CA",
      }),
    ];
  }),
  invalidContent("image alt astral overflow", (input) => {
    const image = imageValue();
    image.altText = astralStringWithCodePoints(2_001);
    input.values = [
      {
        fieldId: stableId("field"),
        owner: { kind: "site" },
        type: "image",
        value: image,
      },
    ];
  }),
  invalidContent("image crop outside normalized rectangle", (input) => {
    const image = imageValue();
    image.crop = { x: 0.75, y: 0, width: 0.5, height: 1 };
    input.values = [
      {
        fieldId: stableId("field"),
        owner: { kind: "site" },
        type: "image",
        value: image,
      },
    ];
  }),
  invalidContent("postal address extra key", (input) => {
    input.values = [
      internalValue("postal_address", {
        streetAddress: "1 Main St",
        addressLocality: "Toronto",
        addressRegion: "ON",
        postalCode: "M5V 2T6",
        addressCountry: "CA",
        district: "Downtown",
      }),
    ];
  }),
  invalidContent("latitude outside range", (input) => {
    input.values = [
      internalValue("geo_coordinates", { latitude: 91, longitude: 0 }),
    ];
  }),
  invalidContent("unknown IANA time zone", (input) => {
    input.values = [
      internalValue("opening_hours", { timeZone: "Mars/Olympus", periods: [] }),
    ];
  }),
  invalidContent("overlapping opening-hour days", (input) => {
    input.values = [
      internalValue("opening_hours", {
        timeZone: "UTC",
        periods: [
          { days: ["monday"], allDay: true, opens: null, closes: null },
          { days: ["monday"], allDay: false, opens: "09:00", closes: "17:00" },
        ],
      }),
    ];
  }),
  invalidContent("invalid indexing bound", (input) => {
    input.values = [
      internalValue("indexing_directives", {
        index: true,
        follow: true,
        archive: true,
        imageIndex: true,
        maxSnippet: 10_001,
        maxImagePreview: "large",
        maxVideoPreview: -1,
      }),
    ];
  }),
];

function runtimeAccepts(
  parse: (input: unknown) => unknown,
  input: unknown,
): boolean {
  try {
    parse(input);
    return true;
  } catch {
    return false;
  }
}

describe("JSON Schema differential corpus", () => {
  it("matches the canonical contract parser across every C2-local class", () => {
    for (const candidate of CONTRACT_CASES) {
      const input = candidate.input();
      assert.equal(
        runtimeAccepts(parseManagedSiteContractV1, input),
        candidate.valid,
        candidate.name,
      );
      assert.equal(
        validateManagedSiteContractV1JsonSchema(input).valid,
        candidate.valid,
        candidate.name,
      );
    }
  });

  it("matches the canonical content parser across every C2-local value class", () => {
    for (const candidate of [
      ...validContentCases(),
      ...INVALID_CONTENT_CASES,
    ]) {
      const input = candidate.input();
      assert.equal(
        runtimeAccepts(parseManagedSiteContentDocument, input),
        candidate.valid,
        candidate.name,
      );
      assert.equal(
        validateManagedSiteContentDocumentJsonSchema(input).valid,
        candidate.valid,
        candidate.name,
      );
    }
  });
});
