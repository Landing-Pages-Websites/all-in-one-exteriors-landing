import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseManagedSiteContentValue } from "../src/index.js";
import { stableId } from "./schema-fixtures.js";

function internalValue(valueType: string, value: unknown): Record<string, unknown> {
  return {
    fieldId: stableId("field"),
    owner: { kind: "site" },
    type: "internal_protected",
    valueType,
    value,
  };
}

const postalAddress = {
  streetAddress: "123 Main Street",
  addressLocality: "Toronto",
  addressRegion: "ON",
  postalCode: "M5V 2T6",
  addressCountry: "CA",
};

const openingHours = {
  timeZone: "America/Toronto",
  periods: [
    { days: ["monday", "tuesday"], allDay: false, opens: "09:00", closes: "17:30" },
    { days: ["saturday"], allDay: true, opens: null, closes: null },
  ],
};

const indexingDirectives = {
  index: true,
  follow: true,
  archive: false,
  imageIndex: true,
  maxSnippet: -1,
  maxImagePreview: "large",
  maxVideoPreview: 0,
};

describe("internal protected content values", () => {
  it("accepts only the exact typed v1 value shapes", () => {
    const valid = [
      ["string", "Gomega"],
      ["url", "https://example.com/business"],
      ["boolean", true],
      ["number", 42.5],
      ["string_list", ["https://example.com/profile"]],
      ["postal_address", postalAddress],
      ["geo_coordinates", { latitude: 43.6532, longitude: -79.3832 }],
      ["opening_hours", openingHours],
      ["opening_hours", { timeZone: "Etc/UTC", periods: [] }],
      ["indexing_directives", indexingDirectives],
      ["json", { arbitrary: ["bounded", true] }],
    ] as const;
    for (const [valueType, value] of valid) {
      assert.doesNotThrow(() => parseManagedSiteContentValue(internalValue(valueType, value)));
    }

    for (const [valueType, value] of [
      ["postal_address", { ...postalAddress, extra: true }],
      ["postal_address", { ...postalAddress, postalCode: undefined }],
      ["postal_address", { ...postalAddress, addressCountry: "can" }],
      ["postal_address", { ...postalAddress, addressLocality: "e\u0301" }],
      ["geo_coordinates", { latitude: 91, longitude: 0 }],
      ["geo_coordinates", { latitude: 0, longitude: -181 }],
      ["geo_coordinates", { latitude: 0, longitude: Number.POSITIVE_INFINITY }],
      ["geo_coordinates", { latitude: "43", longitude: -79 }],
      ["indexing_directives", { ...indexingDirectives, maxSnippet: 10_001 }],
      ["indexing_directives", { ...indexingDirectives, maxVideoPreview: -2 }],
      ["indexing_directives", { ...indexingDirectives, maxImagePreview: "full" }],
      ["indexing_directives", { ...indexingDirectives, extra: true }],
      ["postal_address", "not an address"],
      ["json", undefined],
    ] as const) {
      assert.throws(() => parseManagedSiteContentValue(internalValue(valueType, value)));
    }
  });

  it("enforces IANA zones, canonical times, all-day rules, and disjoint days", () => {
    const invalidPeriods = [
      { ...openingHours, timeZone: "Mars/Olympus_Mons" },
      { ...openingHours, timeZone: "" },
      {
        ...openingHours,
        periods: [{ days: ["monday"], allDay: false, opens: "9:00", closes: "17:00" }],
      },
      {
        ...openingHours,
        periods: [{ days: ["monday"], allDay: false, opens: null, closes: "17:00" }],
      },
      {
        ...openingHours,
        periods: [{ days: ["monday"], allDay: true, opens: "00:00", closes: null }],
      },
      {
        ...openingHours,
        periods: [
          { days: ["monday"], allDay: true, opens: null, closes: null },
          { days: ["monday", "friday"], allDay: true, opens: null, closes: null },
        ],
      },
      {
        ...openingHours,
        periods: [{ days: ["monday", "monday"], allDay: true, opens: null, closes: null }],
      },
      {
        ...openingHours,
        periods: [{ days: [], allDay: true, opens: null, closes: null }],
      },
      { ...openingHours, extra: true },
    ];
    for (const value of invalidPeriods) {
      assert.throws(() =>
        parseManagedSiteContentValue(internalValue("opening_hours", value)),
      );
    }
  });
});
