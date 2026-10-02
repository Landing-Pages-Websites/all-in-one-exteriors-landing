import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ManagedSiteContractError,
  createManagedSiteAstroV1,
  managedSiteFieldAttributesV1,
  managedSitePageAttributesV1,
  normalizeManagedSiteArtifactsV1,
  parseManagedSiteContractV1,
  projectManagedSiteContentDocumentV1,
  type CreateManagedSiteAstroV1Input,
  type ManagedSiteAstroV1,
  type ManagedSiteValueReader,
  type ManagedSiteValueSelector,
  type StableId,
} from "../src/index.js";
import { fixtureId } from "./contract-semantics-fixture.js";
import { sourceProjectionFixture } from "./source-projection-fixture.js";

type JsonObject = Record<string, unknown>;

function astroFixture() {
  const fixture = sourceProjectionFixture();
  (fixture.contract.adapter as JsonObject).kind = "astro";
  return fixture;
}

function createFixtureSite(): ManagedSiteAstroV1 {
  const fixture = astroFixture();
  return createManagedSiteAstroV1({
    contract: fixture.contract,
    sourceDocuments: fixture.sourceDocuments,
  });
}

function expectCode(action: () => unknown, code: string): void {
  assert.throws(action, (error: unknown) => {
    assert.ok(error instanceof ManagedSiteContractError);
    assert.equal(error.code, code);
    return true;
  });
}

function selectorFor(
  value: ManagedSiteAstroV1["content"]["values"][number],
): ManagedSiteValueSelector {
  return { fieldId: value.fieldId, owner: value.owner, type: value.type };
}

function valueOfType<Type extends ManagedSiteValueSelector["type"]>(
  site: ManagedSiteAstroV1,
  type: Type,
) {
  const value = site.content.values.find((candidate) => candidate.type === type);
  if (value === undefined) throw new Error(`Missing fixture value ${type}`);
  return value;
}

function assertCompileTypes(
  site: ManagedSiteAstroV1,
  fieldId: StableId<"field">,
  pageId: StableId<"page">,
): void {
  const readValue: ManagedSiteValueReader = site.readValue;
  const heading = site.readValue({
    fieldId,
    owner: { kind: "page", pageId },
    type: "heading_text",
  });
  heading.value.toUpperCase();
  // @ts-expect-error Astro adapter values remain deeply readonly
  heading.value = "changed";
  // @ts-expect-error Astro adapter contracts remain deeply readonly
  site.contract.pages.push(site.contract.pages[0]);
  readValue({
    // @ts-expect-error selectors require field IDs
    fieldId: pageId,
    owner: { kind: "page", pageId },
    type: "heading_text",
  });
}
void assertCompileTypes;

describe("managed-site Astro adapter", () => {
  it("creates exact trusted content and normalized artifacts", () => {
    const fixture = astroFixture();
    const contract = parseManagedSiteContractV1(fixture.contract);
    const content = projectManagedSiteContentDocumentV1(
      contract,
      fixture.sourceDocuments,
    );
    const site = createManagedSiteAstroV1({
      contract: fixture.contract,
      sourceDocuments: fixture.sourceDocuments,
    });

    assert.deepEqual(site.contract, contract);
    assert.deepEqual(site.content, content);
    assert.deepEqual(
      site.artifacts,
      normalizeManagedSiteArtifactsV1(contract, content),
    );
    assert.equal(Object.isFrozen(site), true);
    assert.deepEqual(Object.keys(site).sort(), [
      "artifacts",
      "content",
      "contract",
      "readValue",
    ]);
  });

  for (const ownerKind of ["site", "page", "collection_item"] as const) {
    it(`reads the exact frozen ${ownerKind} value`, () => {
      const site = createFixtureSite();
      const value = site.content.values.find(
        (candidate) => candidate.owner.kind === ownerKind,
      );
      assert.notEqual(value, undefined);
      if (value === undefined) return;

      const resolved = site.readValue(selectorFor(value));
      assert.equal(resolved, value);
      assert.equal(Object.isFrozen(resolved), true);
    });
  }

  it("returns a type-narrowed value", () => {
    const site = createFixtureSite();
    const heading = valueOfType(site, "heading_text");
    const resolved = site.readValue({
      fieldId: heading.fieldId,
      owner: heading.owner,
      type: "heading_text",
    });
    assert.equal(typeof resolved.value, "string");
  });

  it("fails closed for value selector variants", () => {
    const site = createFixtureSite();
    const heading = valueOfType(site, "heading_text");
    const cases: ReadonlyArray<readonly [ManagedSiteValueSelector, string]> = [
      [
        {
          ...selectorFor(heading),
          fieldId: fixtureId("field") as StableId<"field">,
        },
        "ASTRO_ADAPTER_VALUE_MISSING",
      ],
      [
        { ...selectorFor(heading), owner: { kind: "site" } },
        "ASTRO_ADAPTER_VALUE_MISSING",
      ],
      [
        { ...selectorFor(heading), type: "plain_text" },
        "ASTRO_ADAPTER_VALUE_TYPE",
      ],
      [
        {
          ...selectorFor(heading),
          extra: true,
        } as unknown as ManagedSiteValueSelector,
        "ASTRO_ADAPTER_SELECTOR_INVALID",
      ],
      [
        {
          ...selectorFor(heading),
          owner: {
            kind: "page",
            pageId: site.contract.pages[0].id,
            extra: true,
          },
        } as unknown as ManagedSiteValueSelector,
        "ASTRO_ADAPTER_SELECTOR_INVALID",
      ],
    ];

    for (const [selector, code] of cases) {
      expectCode(() => site.readValue(selector), code);
    }
  });

  it("rejects a non-Astro contract and propagates source failures", () => {
    const nextFixture = sourceProjectionFixture();
    expectCode(
      () =>
        createManagedSiteAstroV1({
          contract: nextFixture.contract,
          sourceDocuments: nextFixture.sourceDocuments,
        }),
      "ASTRO_ADAPTER_KIND",
    );

    const hiddenSource = astroFixture();
    (hiddenSource.sourceDocuments[0].value as JsonObject).hidden = "unclassified";
    expectCode(
      () =>
        createManagedSiteAstroV1({
          contract: hiddenSource.contract,
          sourceDocuments: hiddenSource.sourceDocuments,
        }),
      "SOURCE_VALUE_UNCLASSIFIED",
    );
  });

  it("rejects expanded and accessor-bearing creation inputs", () => {
    const fixture = astroFixture();
    const expanded = {
      contract: fixture.contract,
      sourceDocuments: fixture.sourceDocuments,
      credential: "must-not-be-accepted",
    } as unknown as CreateManagedSiteAstroV1Input;
    expectCode(
      () => createManagedSiteAstroV1(expanded),
      "ASTRO_ADAPTER_INPUT_INVALID",
    );

    let calls = 0;
    const accessor = {
      sourceDocuments: fixture.sourceDocuments,
      get contract() {
        calls += 1;
        return fixture.contract;
      },
    };
    expectCode(
      () => createManagedSiteAstroV1(accessor),
      "JSON_ACCESSOR",
    );
    assert.equal(calls, 0);

    const malformedSource = {
      contract: fixture.contract,
      sourceDocuments: [
        { ...fixture.sourceDocuments[0], credential: "must-not-be-accepted" },
      ],
    } as unknown as CreateManagedSiteAstroV1Input;
    expectCode(
      () => createManagedSiteAstroV1(malformedSource),
      "ASTRO_ADAPTER_INPUT_INVALID",
    );

    const revoked = Proxy.revocable(structuredClone(expanded), {});
    revoked.revoke();
    expectCode(() => createManagedSiteAstroV1(revoked.proxy), "JSON_PROXY");
  });

  it("shares exact credential-free render annotations", () => {
    const site = createFixtureSite();
    const pageId = site.contract.pages[0].id;
    const fieldId = site.content.values[0].fieldId;
    const attributes = {
      page: managedSitePageAttributesV1(pageId),
      field: managedSiteFieldAttributesV1(fieldId),
    };

    assert.deepEqual(attributes.page, { "data-gomega-page-id": pageId });
    assert.deepEqual(attributes.field, { "data-gomega-field-id": fieldId });
    assert.equal(Object.isFrozen(attributes.page), true);
    assert.equal(Object.isFrozen(attributes.field), true);
    assert.doesNotMatch(
      JSON.stringify(attributes),
      /content\/|resolver|nonce|origin|credential/u,
    );
  });
});
