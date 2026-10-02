import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ManagedSiteContractError,
  parseManagedSiteContentDocument,
  parseManagedSiteContentValue,
  parseManagedSiteContractV1,
  validateManagedSiteContentDocumentJsonSchema,
  validateManagedSiteContractV1ContentSemantics,
} from "../src/index.js";
import { contentSemanticsFixture, type ContentSemanticsFixture } from "./content-semantics-fixture.js";
import { contentDocument, imageValue, stableId } from "./schema-fixtures.js";

/**
 * 0.13.0: the contract accepts only values some renderer can render exactly.
 * A crop must cover at least one pixel of its image on each axis, and an
 * internal destination -- a link field's or a prose mark's, one predicate --
 * must name a page with a single static path.
 */

type JsonObject = Record<string, unknown>;

function outcome(check: () => unknown): "accepted" | "rejected" {
  try {
    check();
    return "accepted";
  } catch {
    return "rejected";
  }
}

/** A 1024 x 512 image, so one pixel is an exact binary fraction on each axis. */
function imageWithCrop(crop: unknown): JsonObject {
  return {
    fieldId: stableId("field"),
    owner: { kind: "page", pageId: stableId("page") },
    type: "image",
    value: { ...imageValue(), width: 1024, height: 512, crop },
  };
}

const PIXEL_X = 1 / 1024;
const PIXEL_Y = 1 / 512;

describe("a crop covers at least one pixel on each axis", () => {
  const cases: readonly [string, unknown, "accepted" | "rejected"][] = [
    ["no crop", null, "accepted"],
    ["the whole frame", { x: 0, y: 0, width: 1, height: 1 }, "accepted"],
    ["exactly one pixel on each axis", { x: 0, y: 0, width: PIXEL_X, height: PIXEL_Y }, "accepted"],
    ["one pixel in the far corner", { x: 1 - PIXEL_X, y: 1 - PIXEL_Y, width: PIXEL_X, height: PIXEL_Y }, "accepted"],
    ["just under a pixel wide", { x: 0, y: 0, width: PIXEL_X * 0.999999, height: 1 }, "rejected"],
    ["just under a pixel tall", { x: 0, y: 0, width: 1, height: PIXEL_Y * 0.999999 }, "rejected"],
    ["1e-307 wide (the reviewer's case)", { x: 0, y: 0, width: 1e-307, height: 1 }, "rejected"],
    ["the smallest positive number tall", { x: 0, y: 0, width: 1, height: Number.MIN_VALUE }, "rejected"],
    ["NaN", { x: 0, y: 0, width: Number.NaN, height: 1 }, "rejected"],
    ["Infinity", { x: 0, y: 0, width: Number.POSITIVE_INFINITY, height: 1 }, "rejected"],
    ["past the right edge", { x: 0.5, y: 0, width: 0.6, height: 1 }, "rejected"],
    ["zero wide", { x: 0, y: 0, width: 0, height: 1 }, "rejected"],
  ];
  for (const [name, crop, expected] of cases) {
    it(`${expected === "accepted" ? "accepts" : "refuses"} ${name}`, () => {
      assert.equal(outcome(() => parseManagedSiteContentValue(imageWithCrop(crop))), expected);
    });
  }

  it("bounds by the image's own resolution: the same fraction is a pixel of one image and not another", () => {
    const crop = { x: 0, y: 0, width: 1 / 1024, height: 1 };
    assert.equal(outcome(() => parseManagedSiteContentValue(imageWithCrop(crop))), "accepted");
    const smaller = { ...imageWithCrop(crop), value: { ...(imageWithCrop(crop).value as JsonObject), width: 512, height: 256 } };
    assert.equal(outcome(() => parseManagedSiteContentValue(smaller)), "rejected");
  });
});

/** The largest double below a positive finite one. */
function nextDoubleBelow(value: number): number {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value);
  view.setBigUint64(0, view.getBigUint64(0) - 1n);
  return view.getFloat64(0);
}

function croppedImage(width: number, height: number, crop: JsonObject): JsonObject {
  return {
    fieldId: stableId("field"),
    owner: { kind: "page", pageId: stableId("page") },
    type: "image",
    value: { ...imageValue(), width, height, crop },
  };
}

const MAX_SIDE = 5000;

/**
 * One pixel is written 1/w. Every such value is accepted and the next double
 * below it refused, on each axis, for every side 1..5000, by the zod parser and
 * by the published JSON Schema's validator (whose gomegaSemanticV1 keyword runs
 * the same rule). The product form refused 540 of these one-pixel values.
 */
describe("a one-pixel crop, written 1/w, for every side up to 5000", () => {
  const axes = [
    ["width", (side: number, size: number) => croppedImage(side, 1, { x: 0, y: 0, width: size, height: 1 })],
    ["height", (side: number, size: number) => croppedImage(1, side, { x: 0, y: 0, width: 1, height: size })],
  ] as const;
  const validators = [
    ["zod", (value: JsonObject) => outcome(() => parseManagedSiteContentValue(value))],
    [
      "the JSON Schema validator",
      (value: JsonObject) =>
        validateManagedSiteContentDocumentJsonSchema({ ...contentDocument(), values: [value] }).valid ? "accepted" : "rejected",
    ],
  ] as const;
  for (const [axis, build] of axes) {
    for (const [name, judge] of validators) {
      it(`${axis}, through ${name}`, () => {
        const wrong: string[] = [];
        for (let side = 1; side <= MAX_SIDE; side += 1) {
          const pixel = 1 / side;
          if (judge(build(side, pixel)) !== "accepted") wrong.push(`1/${String(side)} refused`);
          if (judge(build(side, nextDoubleBelow(pixel))) !== "rejected") {
            wrong.push(`just below 1/${String(side)} accepted`);
          }
        }
        assert.deepEqual(wrong.slice(0, 10), [], `${String(wrong.length)} wrong`);
      });
    }
  }

  it("includes the width the product form got wrong first", () => {
    assert.ok((1 / 49) * 49 < 1, "the double arithmetic the division form avoids");
    assert.equal(outcome(() => parseManagedSiteContentValue(croppedImage(49, 1, { x: 0, y: 0, width: 1 / 49, height: 1 }))), "accepted");
  });
});

function validate(mutate: (fixture: ContentSemanticsFixture) => void): "accepted" | "rejected" {
  const fixture = contentSemanticsFixture();
  mutate(fixture);
  return outcome(() =>
    validateManagedSiteContractV1ContentSemantics(
      parseManagedSiteContractV1(fixture.contract),
      parseManagedSiteContentDocument(fixture.content),
    ),
  );
}

function refusalCode(mutate: (fixture: ContentSemanticsFixture) => void): string | null {
  const fixture = contentSemanticsFixture();
  mutate(fixture);
  try {
    validateManagedSiteContractV1ContentSemantics(
      parseManagedSiteContractV1(fixture.contract),
      parseManagedSiteContentDocument(fixture.content),
    );
    return null;
  } catch (error) {
    return error instanceof ManagedSiteContractError ? error.code : String(error);
  }
}

function linkDestination(fixture: ContentSemanticsFixture): JsonObject {
  const value = (fixture.content.values as JsonObject[]).find((one) => one.fieldId === fixture.ids.linkField);
  if (value === undefined) throw new Error("fixture lost its link field");
  return (value.value as JsonObject).destination as JsonObject;
}

function markDestination(fixture: ContentSemanticsFixture): JsonObject {
  const value = (fixture.content.values as JsonObject[]).find((one) => one.fieldId === fixture.ids.richField);
  const paragraph = ((value?.value as JsonObject).content as JsonObject[])[0] as JsonObject;
  const marks = ((paragraph.content as JsonObject[])[0] as JsonObject).marks as JsonObject[];
  const link = marks.find((mark) => mark.type === "link");
  if (link === undefined) throw new Error("fixture lost its link mark");
  return link.destination as JsonObject;
}

function findLinkField(fixture: ContentSemanticsFixture): JsonObject {
  for (const page of fixture.contract.pages as JsonObject[]) {
    for (const section of page.sections as JsonObject[]) {
      const field = (section.fields as JsonObject[]).find((one) => one.id === fixture.ids.linkField);
      if (field !== undefined) return field;
    }
  }
  throw new Error("fixture lost its link field descriptor");
}

/** The home page moved onto the generated pattern's prefix: /services beside /services/[slug]. */
function staticPageAtGeneratedPrefix(fixture: ContentSemanticsFixture): void {
  const [home] = fixture.contract.pages as JsonObject[];
  (home as JsonObject).route = { kind: "static", path: "/services" };
}

describe("an internal destination names a page with a single path", () => {
  it("accepts a link field and a prose link to a static page", () => {
    assert.equal(validate(() => undefined), "accepted");
  });

  it("refuses a link field to a generated page, and a prose link, each with its code", () => {
    assert.equal(
      refusalCode((fixture) => void (linkDestination(fixture).pageId = fixture.ids.generatedPage)),
      "CONTENT_LINK_PAGE_UNPATHED",
    );
    assert.equal(
      refusalCode((fixture) => void (markDestination(fixture).pageId = fixture.ids.generatedPage)),
      "CONTENT_RICH_TEXT_LINK_PAGE_UNPATHED",
    );
  });

  it("refuses a generated page with a fragment", () => {
    assert.equal(
      refusalCode((fixture) => {
        // The field declares the fragment, so only the page can be at fault.
        const field = findLinkField(fixture);
        field.constraints = { ...(field.constraints as JsonObject), fragmentPolicy: "declared", allowedFragments: ["team"] };
        const destination = linkDestination(fixture);
        destination.pageId = fixture.ids.generatedPage;
        destination.fragment = "team";
      }),
      "CONTENT_LINK_PAGE_UNPATHED",
    );
  });

  it("tells a static page from a generated one with the same prefix", () => {
    assert.equal(validate(staticPageAtGeneratedPrefix), "accepted", "/services is a page");
    assert.equal(
      refusalCode((fixture) => {
        staticPageAtGeneratedPrefix(fixture);
        linkDestination(fixture).pageId = fixture.ids.generatedPage;
      }),
      "CONTENT_LINK_PAGE_UNPATHED",
      "/services/[slug] is not, however close its path",
    );
  });
});
