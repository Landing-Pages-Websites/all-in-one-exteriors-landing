import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  parseManagedInternalProtectedField,
  parseManagedSiteSeoDescriptor,
} from "../src/index.js";
import { internalProtectedField, seoDescriptor } from "./schema-fixtures.js";

describe("internal SEO schemas", () => {
  it("keeps SEO fields internal, protected, and capability-free", () => {
    assert.doesNotThrow(() =>
      parseManagedInternalProtectedField(internalProtectedField()),
    );
    for (const invalid of [
      { ...internalProtectedField(), classification: "customer_editable" },
      { ...internalProtectedField(), capabilities: ["text.edit"] },
      { ...internalProtectedField(), classification: "ignore" },
    ]) {
      assert.throws(() => parseManagedInternalProtectedField(invalid));
    }
  });

  it("requires typed business, page, JSON-LD, sitemap, redirect, and budget declarations", () => {
    assert.doesNotThrow(() => parseManagedSiteSeoDescriptor(seoDescriptor()));
    const executable = structuredClone(seoDescriptor());
    const page = (executable.pages as Record<string, unknown>[])[0];
    page.jsonLd = [{ script: "return { '@type': 'LocalBusiness' }" }];
    assert.throws(() => parseManagedSiteSeoDescriptor(executable));

    const unsafeRedirect = structuredClone(seoDescriptor());
    (unsafeRedirect.redirects as Record<string, unknown>[])[0] = {
      fromPath: "/old",
      destination: { kind: "external", url: "javascript:alert(1)" },
      status: 301,
      preserveQuery: false,
    };
    assert.throws(() => parseManagedSiteSeoDescriptor(unsafeRedirect));
  });

  it("represents an unknown postal address without inventing business data", () => {
    const input = structuredClone(seoDescriptor());
    const businessIdentity = input.businessIdentity as Record<string, unknown>;
    businessIdentity.postalAddress = null;

    const parsed = parseManagedSiteSeoDescriptor(input);

    assert.equal(parsed.businessIdentity.postalAddress, null);
  });
});
