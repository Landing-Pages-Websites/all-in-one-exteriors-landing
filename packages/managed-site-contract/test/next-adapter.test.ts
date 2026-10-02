import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ManagedSiteContractError,
  createManagedSiteNextV1,
  managedSiteFieldAttributesV1,
  managedSitePageAttributesV1,
  mintStableId,
  normalizeManagedSiteArtifactsV1,
  parseManagedSiteContractV1,
  projectManagedSiteContentDocumentV1,
  type CreateManagedSiteNextV1Input,
  type ManagedSiteNextV1,
  type ManagedSiteNextValueSelector,
  type StableId,
} from "../src/index.js";
import { fixtureId } from "./contract-semantics-fixture.js";
import { sourceProjectionFixture } from "./source-projection-fixture.js";

type JsonObject = Record<string, unknown>;

function createFixtureSite(): ManagedSiteNextV1 {
  const fixture = sourceProjectionFixture();
  return createManagedSiteNextV1({
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

function valueOfType<Type extends ManagedSiteNextValueSelector["type"]>(
  site: ManagedSiteNextV1,
  type: Type,
) {
  const value = site.content.values.find((candidate) => candidate.type === type);
  if (value === undefined) throw new Error(`Missing fixture value ${type}`);
  return value;
}

function selectorFor(
  value: ManagedSiteNextV1["content"]["values"][number],
): ManagedSiteNextValueSelector {
  return { fieldId: value.fieldId, owner: value.owner, type: value.type };
}

function assertCompileTypes(
  site: ManagedSiteNextV1,
  fieldId: StableId<"field">,
  pageId: StableId<"page">,
): void {
  const heading = site.readValue({
    fieldId,
    owner: { kind: "page", pageId },
    type: "heading_text",
  });
  heading.value.toUpperCase();
  // @ts-expect-error returned values remain deeply readonly
  heading.value = "changed";
  // @ts-expect-error adapter contract remains deeply readonly
  site.contract.pages.push(site.contract.pages[0]);
  // @ts-expect-error selectors require field IDs
  site.readValue({ fieldId: pageId, owner: { kind: "page", pageId }, type: "heading_text" });
}
void assertCompileTypes;

describe("managed-site Next.js adapter", () => {
  it("creates exact trusted content and normalized artifacts", () => {
    const fixture = sourceProjectionFixture();
    const contract = parseManagedSiteContractV1(fixture.contract);
    const content = projectManagedSiteContentDocumentV1(
      contract,
      fixture.sourceDocuments,
    );
    const artifacts = normalizeManagedSiteArtifactsV1(contract, content);
    const site = createManagedSiteNextV1({
      contract: fixture.contract,
      sourceDocuments: fixture.sourceDocuments,
    });

    assert.deepEqual(site.contract, contract);
    assert.deepEqual(site.content, content);
    assert.deepEqual(site.artifacts, artifacts);
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

  it("returns a type-narrowed heading value", () => {
    const site = createFixtureSite();
    const heading = valueOfType(site, "heading_text");
    const resolved = site.readValue({
      fieldId: heading.fieldId,
      owner: heading.owner,
      type: "heading_text",
    });

    assert.equal(typeof resolved.value, "string");
  });

  it("fails closed for missing, wrong-owner, wrong-type, and expanded selectors", () => {
    const site = createFixtureSite();
    const heading = valueOfType(site, "heading_text");
    const cases: ReadonlyArray<readonly [ManagedSiteNextValueSelector, string]> = [
      [
        { ...selectorFor(heading), fieldId: fixtureId("field") as StableId<"field"> },
        "NEXT_ADAPTER_VALUE_MISSING",
      ],
      [
        { ...selectorFor(heading), owner: { kind: "site" } },
        "NEXT_ADAPTER_VALUE_MISSING",
      ],
      [
        { ...selectorFor(heading), type: "plain_text" },
        "NEXT_ADAPTER_VALUE_TYPE",
      ],
      [
        { ...selectorFor(heading), extra: true } as unknown as ManagedSiteNextValueSelector,
        "NEXT_ADAPTER_SELECTOR_INVALID",
      ],
    ];

    for (const [selector, code] of cases) {
      expectCode(() => site.readValue(selector), code);
    }
  });

  it("rejects a non-Next contract and propagates source failures", () => {
    const wrongAdapter = sourceProjectionFixture();
    (wrongAdapter.contract.adapter as JsonObject).kind = "astro";
    expectCode(
      () =>
        createManagedSiteNextV1({
          contract: wrongAdapter.contract,
          sourceDocuments: wrongAdapter.sourceDocuments,
        }),
      "NEXT_ADAPTER_KIND",
    );

    const hiddenSource = sourceProjectionFixture();
    (hiddenSource.sourceDocuments[0].value as JsonObject).hidden = "unclassified";
    expectCode(
      () =>
        createManagedSiteNextV1({
          contract: hiddenSource.contract,
          sourceDocuments: hiddenSource.sourceDocuments,
        }),
      "SOURCE_VALUE_UNCLASSIFIED",
    );
  });

  it("rejects expanded and accessor-bearing creation inputs", () => {
    const fixture = sourceProjectionFixture();
    const expanded = {
      contract: fixture.contract,
      sourceDocuments: fixture.sourceDocuments,
      credential: "must-not-be-accepted",
    } as unknown as CreateManagedSiteNextV1Input;
    expectCode(
      () => createManagedSiteNextV1(expanded),
      "NEXT_ADAPTER_INPUT_INVALID",
    );

    let calls = 0;
    const accessor = {
      sourceDocuments: fixture.sourceDocuments,
      get contract() {
        calls += 1;
        return fixture.contract;
      },
    };
    expectCode(() => createManagedSiteNextV1(accessor), "JSON_ACCESSOR");
    assert.equal(calls, 0);
  });

  it("emits exact credential-free frozen render annotations", () => {
    const site = createFixtureSite();
    const pageId = site.contract.pages[0].id;
    const fieldId = site.content.values[0].fieldId;
    const page = managedSitePageAttributesV1(pageId);
    const field = managedSiteFieldAttributesV1(fieldId);

    assert.deepEqual(page, { "data-gomega-page-id": pageId });
    assert.deepEqual(field, { "data-gomega-field-id": fieldId });
    assert.equal(Object.isFrozen(page), true);
    assert.equal(Object.isFrozen(field), true);
    const serialized = JSON.stringify({ page, field });
    for (const forbidden of [
      "content/",
      "resolver",
      "internalSeo",
      "nonce",
      "origin",
      "credential",
    ]) {
      assert.equal(serialized.includes(forbidden), false);
    }
  });

  /**
   * A collection declares its fields once and renders them once per item, so a
   * field id alone names a column. Without the row, two items' copies of one
   * field are indistinguishable in the page -- which is why item values used to
   * carry no annotation rather than an ambiguous one.
   */
  it("names the item as well as the field for a collection's copy", () => {
    const site = createFixtureSite();
    const fieldId = site.content.values[0].fieldId;
    const itemId = mintStableId("item");

    assert.deepEqual(managedSiteFieldAttributesV1(fieldId, itemId), {
      "data-gomega-field-id": fieldId,
      "data-gomega-item-id": itemId,
    });
  });

  it("leaves the item out for a value the page owns", () => {
    const site = createFixtureSite();
    const fieldId = site.content.values[0].fieldId;

    assert.deepEqual(
      Object.keys(managedSiteFieldAttributesV1(fieldId)),
      ["data-gomega-field-id"],
    );
  });

  it("freezes the annotation whether or not it names an item", () => {
    const site = createFixtureSite();
    const fieldId = site.content.values[0].fieldId;

    assert.equal(
      Object.isFrozen(managedSiteFieldAttributesV1(fieldId, mintStableId("item"))),
      true,
    );
  });

  it("rejects cross-kind annotation IDs", () => {
    const site = createFixtureSite();
    expectCode(
      () =>
        managedSitePageAttributesV1(
          site.content.values[0].fieldId as unknown as StableId<"page">,
        ),
      "STABLE_ID_KIND_MISMATCH",
    );
    expectCode(
      () =>
        managedSiteFieldAttributesV1(
          site.contract.pages[0].id as unknown as StableId<"field">,
        ),
      "STABLE_ID_KIND_MISMATCH",
    );
    // An item id is held to its own kind: a field id in that slot would produce
    // markup naming a row that is really a column, and nothing downstream could
    // tell.
    expectCode(
      () =>
        managedSiteFieldAttributesV1(
          site.content.values[0].fieldId,
          site.contract.pages[0].id as unknown as StableId<"item">,
        ),
      "STABLE_ID_KIND_MISMATCH",
    );
  });
});
