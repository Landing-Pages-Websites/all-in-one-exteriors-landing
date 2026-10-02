import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  MAX_LINK_LABEL_CHARACTERS,
  ManagedSiteContractError,
  parseManagedSiteContentDocument,
  parseManagedSiteContractV1,
  validateManagedSiteContractV1ContentSemantics,
} from "../src/index.js";
import { contentSemanticsFixture, type ContentSemanticsFixture } from "./content-semantics-fixture.js";

/**
 * Every text value megaseo-web's CMS bounds with `char_length` is measured here
 * in code points too, so an emoji counts once and a value the CMS saved is not
 * refused at publish. `minLength` keeps admitting what UTF-16 length admitted.
 */

type JsonObject = Record<string, unknown>;

const EMOJI = "\u{1F600}";

function codeOf(fixture: ContentSemanticsFixture): string {
  try {
    validateManagedSiteContractV1ContentSemantics(
      parseManagedSiteContractV1(fixture.contract),
      parseManagedSiteContentDocument(fixture.content),
    );
  } catch (error) {
    if (error instanceof ManagedSiteContractError) return error.code;
    // A value's own schema bound refuses before semantics, as a ZodError.
    if (error instanceof Error && error.name === "ZodError") return "SCHEMA";
    throw error;
  }
  return "ACCEPTED";
}

function field(fixture: ContentSemanticsFixture, fieldId: string): JsonObject {
  const pages = fixture.contract.pages as JsonObject[];
  const fields = ((pages[0].sections as JsonObject[])[0].fields as JsonObject[]);
  const found = fields.find((candidate) => candidate.id === fieldId);
  if (found === undefined) throw new Error(`Missing field ${fieldId}`);
  return found;
}

function value(fixture: ContentSemanticsFixture, fieldId: string): JsonObject {
  const found = (fixture.content.values as JsonObject[]).find((candidate) => candidate.fieldId === fieldId);
  if (found === undefined) throw new Error(`Missing value ${fieldId}`);
  return found;
}

interface LengthCase {
  readonly name: string;
  readonly apply: (fixture: ContentSemanticsFixture) => void;
  readonly accepted: boolean;
}

function headingCases(): readonly LengthCase[] {
  const at = (count: number, max: number) => (fixture: ContentSemanticsFixture) => {
    (field(fixture, fixture.ids.titleField).constraints as JsonObject).maxLength = max;
    value(fixture, fixture.ids.titleField).value = EMOJI.repeat(count);
  };
  return [
    { name: "heading: 80 emoji at maxLength 80", apply: at(80, 80), accepted: true },
    { name: "heading: 81 emoji at maxLength 80", apply: at(81, 80), accepted: false },
    {
      name: "heading: one emoji at minLength 2 (UTF-16 length 2)",
      apply: (fixture) => {
        (field(fixture, fixture.ids.titleField).constraints as JsonObject).minLength = 2;
        value(fixture, fixture.ids.titleField).value = EMOJI;
      },
      accepted: true,
    },
  ];
}

function linkLabelCases(): readonly LengthCase[] {
  const at = (count: number, max: number) => (fixture: ContentSemanticsFixture) => {
    const constraints = field(fixture, fixture.ids.linkField).constraints as JsonObject;
    (constraints.labelConstraints as JsonObject).maxLength = max;
    (value(fixture, fixture.ids.linkField).value as JsonObject).label = EMOJI.repeat(count);
  };
  return [
    { name: "link label: 80 emoji at maxLength 80", apply: at(80, 80), accepted: true },
    { name: "link label: 81 emoji at maxLength 80", apply: at(81, 80), accepted: false },
    { name: `link label: ${MAX_LINK_LABEL_CHARACTERS} emoji at the label ceiling`, apply: at(MAX_LINK_LABEL_CHARACTERS, MAX_LINK_LABEL_CHARACTERS), accepted: true },
    { name: `link label: ${MAX_LINK_LABEL_CHARACTERS + 1} emoji past the label ceiling`, apply: at(MAX_LINK_LABEL_CHARACTERS + 1, MAX_LINK_LABEL_CHARACTERS), accepted: false },
  ];
}

function altTextCases(): readonly LengthCase[] {
  const at = (count: number) => (fixture: ContentSemanticsFixture) => {
    (value(fixture, fixture.ids.imageField).value as JsonObject).altText = EMOJI.repeat(count);
  };
  return [
    { name: "alt text: 2000 emoji", apply: at(2_000), accepted: true },
    { name: "alt text: 2001 emoji", apply: at(2_001), accepted: false },
  ];
}

describe("text lengths are code points", () => {
  for (const { name, apply, accepted } of [...headingCases(), ...linkLabelCases(), ...altTextCases()]) {
    it(`${accepted ? "admits" : "refuses"} ${name}`, () => {
      const fixture = contentSemanticsFixture();
      apply(fixture);
      const code = codeOf(fixture);
      if (accepted) assert.equal(code, "ACCEPTED");
      else assert.notEqual(code, "ACCEPTED");
    });
  }
});
