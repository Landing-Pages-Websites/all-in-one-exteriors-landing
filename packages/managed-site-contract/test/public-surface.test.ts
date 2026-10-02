import assert from "node:assert/strict";
import { describe, it } from "node:test";

import * as publicApi from "../src/index.js";
import type {
  ManagedRichTextDocument,
  ManagedSiteAstroV1,
  ManagedSiteContentDocument,
  ManagedSiteContractV1,
  ManagedSiteNextV1,
  ManagedSiteSourceDocumentV1,
} from "../src/index.js";
import {
  assetSlot,
  collectionBounds,
  collectionDescriptor,
  contentDocument,
  imageValue,
  internalProtectedField,
  managedSiteContract,
  performanceBudget,
  plainTextField,
  richTextConstraints,
  richTextContentValue,
  richTextDocument,
  seoDescriptor,
  sitemapPolicy,
  stableId,
  textConstraints,
} from "./schema-fixtures.js";
import { conformingContract } from "./contract-semantics-fixture.js";

type Surface = {
  readonly name: string;
  readonly args: readonly unknown[];
  readonly invoke: (args: readonly unknown[]) => unknown;
};

const plainContentValue = {
  fieldId: stableId("field"),
  owner: { kind: "site" },
  type: "plain_text",
  value: "Hello",
};
const collectionContentValue = {
  ...plainContentValue,
  type: "collection",
  value: { orderedItemIds: [stableId("item")] },
};
const richDocument = richTextDocument([
  { type: "paragraph", content: [{ type: "text", text: "Hello" }] },
]);

const surfaces: readonly Surface[] = [
  surface("parseManagedRichTextDocument", [richDocument]),
  surface("parseManagedFieldDescriptor", [plainTextField()]),
  surface("parseManagedCollectionDescriptor", [collectionDescriptor()]),
  surface("parseManagedSiteContentValue", [plainContentValue]),
  surface("parseManagedSiteContentDocument", [contentDocument()]),
  surface("parseManagedInternalProtectedField", [internalProtectedField()]),
  surface("parseManagedSiteSeoDescriptor", [seoDescriptor()]),
  surface("parseManagedSitemapPolicy", [sitemapPolicy()]),
  surface("parseManagedTextConstraints", [textConstraints()]),
  surface("parseManagedLinkLabelConstraints", [textConstraints()]),
  surface("parseManagedRichTextConstraints", [richTextConstraints()]),
  surface("parseManagedCollectionBounds", [collectionBounds()]),
  surface("parseManagedAbsoluteHttpsUrl", ["https://example.com/"]),
  surface("parseManagedInternalString", ["Example Holdings Ltd"]),
  surface("parseManagedInternalStringList", [["https://example.com/"]]),
  surface("parseManagedPerformanceBudget", [performanceBudget()]),
  surface("parseManagedSiteContractV1", [managedSiteContract()]),
  surface("parseManagedSiteFieldMigrationV1", [{
    schemaVersion: "1.0",
    from: { contractSha256: "a".repeat(64), contentSha256: "b".repeat(64) },
    steps: [],
  }]),
  surface("validateManagedFieldValue", [plainTextField(), plainContentValue]),
  surface("validateManagedCollectionValue", [
    collectionDescriptor(),
    collectionContentValue,
  ]),
  surface("validateManagedImageValue", [assetSlot(), imageValue()]),
  surface("resolveManagedImageAltText", [assetSlot(), imageValue()]),
];

function surface(
  name: keyof typeof publicApi,
  args: readonly unknown[],
): Surface {
  const candidate = publicApi[name];
  assert.equal(typeof candidate, "function", `${name} must be a function`);
  const callable = candidate as (...values: readonly unknown[]) => unknown;
  return { name, args, invoke: (values) => callable(...values) };
}

function accessorInput(input: object, calls: { count: number }): object {
  const clone = structuredClone(input) as Record<string, unknown>;
  const [key] = Object.keys(clone);
  assert.notEqual(key, undefined);
  const value = clone[key];
  Object.defineProperty(clone, key, {
    enumerable: true,
    get() {
      calls.count += 1;
      return value;
    },
  });
  return clone;
}

function revokedProxy(input: object): object {
  const revocable = Proxy.revocable(structuredClone(input), {});
  revocable.revoke();
  return revocable.proxy;
}

function assertDeepFrozen(input: unknown, seen = new Set<object>()): void {
  if (input === null || typeof input !== "object" || seen.has(input)) return;
  seen.add(input);
  assert.equal(Object.isFrozen(input), true);
  for (const value of Object.values(input)) assertDeepFrozen(value, seen);
}

function assertDeepReadonlyTypes(
  contract: ManagedSiteContractV1,
  content: ManagedSiteContentDocument,
  richText: ManagedRichTextDocument,
  source: ManagedSiteSourceDocumentV1,
  nextSite: ManagedSiteNextV1,
  astroSite: ManagedSiteAstroV1,
): void {
  // @ts-expect-error public contract arrays are deeply readonly
  contract.pages.push(contract.pages[0]);
  // @ts-expect-error nested content owners are deeply readonly
  content.values[0].owner.kind = "site";
  // @ts-expect-error nested rich-text arrays are deeply readonly
  richText.content[0].content = [];
  // @ts-expect-error source-document paths are readonly
  source.path = "content/other.json";
  // @ts-expect-error Next adapter data is deeply readonly
  nextSite.content.values[0].owner.kind = "site";
  // @ts-expect-error Astro adapter data is deeply readonly
  astroSite.content.values[0].owner.kind = "site";
}
void assertDeepReadonlyTypes;

describe("public managed-site surface", () => {
  it("exports only safe C2 functions, types, and frozen constants", () => {
    const actual = Object.keys(publicApi)
      .filter((name) =>
        /^(createManaged|deriveManaged|managedSite.*Attributes|normalizeManaged|parseManaged|projectManaged|resolveManaged|validateManaged)/u.test(
          name,
        ),
      )
      .sort();
    assert.deepEqual(
      actual,
      [
        ...surfaces.map(({ name }) => name),
        "createManagedSiteAstroV1",
        "createManagedSiteNextV1",
        "deriveManagedSiteGuardContractFactsV1",
        "deriveManagedSiteGuardPolicyFactsV1",
        "managedSiteFieldAttributesV1",
        "managedSitePageAttributesV1",
        "normalizeManagedSiteArtifactsV1",
        "projectManagedSiteContentDocumentV1",
        "validateManagedSiteContentDocumentJsonSchema",
        "validateManagedSiteContractV1JsonSchema",
        "validateManagedSiteContractV1ContentSemantics",
        "validateManagedSiteContractV1Compatibility",
        "validateManagedSiteContractV1MigrationCompatibility",
        "validateManagedSiteContractV1Semantics",
      ].sort(),
    );
    assert.deepEqual(
      Object.keys(publicApi).filter(
        (name) =>
          name.endsWith("Schema") &&
          typeof publicApi[name as keyof typeof publicApi] !== "function",
      ),
      [],
    );
    assert.equal(Object.isFrozen(publicApi.MANAGED_FIELD_CAPABILITIES), true);
    assert.deepEqual(publicApi.MANAGED_FIELD_SCOPES, ["site", "page"]);
    assert.equal(Object.isFrozen(publicApi.MANAGED_FIELD_SCOPES), true);
    assert.deepEqual(publicApi.MANAGED_SEO_TEXT_SEMANTICS, ["seo_title", "seo_description"]);
    assert.equal(Object.isFrozen(publicApi.MANAGED_SEO_TEXT_SEMANTICS), true);
    assert.equal(publicApi.MAX_MANAGED_SEO_TEXT_CHARACTERS, 320);
    assert.equal(publicApi.hasUnsafeTextCharacter("Home | Gomega"), false);
    for (const unsafe of ["\n", "\r", "\t", "\u0000", "\u007f", "\u0085", "\u2028", "\u2029", "\u202e", "\u2066"]) {
      assert.equal(publicApi.hasUnsafeTextCharacter(`Home${unsafe}Gomega`), true);
    }
    assert.equal(
      Object.isFrozen(publicApi.MANAGED_SITE_JSON_SCHEMA_BUNDLE_V1),
      true,
    );
  });

  /**
   * Object arguments only: the probes replace an argument with one whose keys are
   * getters, or with a revoked proxy, and a string has neither. Skipping them is
   * the absence of a question, not a weakened answer.
   */
  it("rejects accessors and revoked proxies at every argument boundary", () => {
    for (const target of surfaces) {
      for (const [index, argument] of target.args.entries()) {
        if (typeof argument !== "object" || argument === null) continue;
        const calls = { count: 0 };
        const accessorArgs = target.args.map((arg, argIndex) =>
          argIndex === index ? accessorInput(arg as object, calls) : arg,
        );
        assert.throws(() => target.invoke(accessorArgs), target.name);
        assert.equal(calls.count, 0, target.name);
        const proxyArgs = target.args.map((arg, argIndex) =>
          argIndex === index ? revokedProxy(arg as object) : arg,
        );
        assert.throws(() => target.invoke(proxyArgs), target.name);
      }
    }
  });

  it("returns a deeply frozen graph from every public parser and validator", () => {
    for (const target of surfaces) assertDeepFrozen(target.invoke(target.args));
  });

  it("exposes only frozen C3B-deferred item IDs from semantic validation", () => {
    const contract = publicApi.parseManagedSiteContractV1(conformingContract());
    const result = publicApi.validateManagedSiteContractV1Semantics(contract);
    assertDeepFrozen(result);
    assert.equal(result.deferred.itemIds.length, 1);
  });

  it("rejects oversized rich text through every accepting public surface", () => {
    const oversized = richTextContentValue("https://example.com");
    const value = oversized.value as Record<string, unknown>;
    const paragraph = (value.content as Record<string, unknown>[])[0];
    // The linked text is the node itself now, so the oversized string goes on it
    // rather than on a child of a link node.
    (paragraph.content as Record<string, unknown>[])[0].text = "x".repeat(131_073);
    const document = {
      schemaVersion: "1.0",
      values: [oversized],
      assetManifest: [],
    };
    const richField = structuredClone(plainTextField());
    Object.assign(richField, {
      type: "rich_text",
      capabilities: ["text.edit"],
      constraints: {
        maxCharacters: 131_072,
        maxNodes: 2_000,
        allowedBlocks: ["paragraph"],
        allowedMarks: [],
        allowLinks: true,
        allowedExternalHosts: ["example.com"],
        allowedTargets: ["same_window"],
      },
    });
    delete richField.semantic;
    assert.throws(() => publicApi.parseManagedRichTextDocument(value));
    assert.throws(() => publicApi.parseManagedSiteContentValue(oversized));
    assert.throws(() => publicApi.parseManagedSiteContentDocument(document));
    assert.throws(() =>
      publicApi.validateManagedFieldValue(richField, oversized),
    );
  });
});
