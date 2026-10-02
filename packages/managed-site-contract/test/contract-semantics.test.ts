import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseManagedSiteContractV1 } from "../src/contract.js";
import type { ManagedSiteContractV1 } from "../src/contract.js";
import { collectManagedSiteContractV1Facts } from "../src/contract-semantics-facts.js";
import {
  MANAGED_SITE_CONTRACT_OCCURRENCE_REGISTRY,
  collectManagedSiteContractOccurrences,
  isManagedSiteOccurrencePathToken,
} from "../src/contract-occurrence-registry.js";
import { ManagedSiteContractError } from "../src/errors.js";
import { validateManagedSiteContractIdentityFacts } from "../src/contract-semantics-identity.js";
import { validateManagedSiteContractRouteFacts } from "../src/contract-semantics-routes.js";
import { validateManagedSiteContractSourceFacts } from "../src/contract-semantics-source.js";
import { conformingContract, fixtureId } from "./contract-semantics-fixture.js";

interface MutableContract {
  readonly pages: Array<{
    id: string;
    route: { kind?: string; collectionId: string; routeKeyFieldId: string; pattern?: string; path?: string };
    sections: Array<{ fields: Array<{ id: string }> }>;
  }>;
  readonly collections: Array<{ id: string }>;
  readonly assets: Array<{ id: string }>;
  tombstonedIds: string[];
  readonly atomicAliasGroups: Array<{ id: string; fieldIds: string[] }>;
}

function mutableContract(contract: Record<string, unknown>): MutableContract {
  return contract as unknown as MutableContract;
}

function contractFacts(input: Record<string, unknown>) {
  return collectManagedSiteContractV1Facts(parseManagedSiteContractV1(input));
}

function unsafeContractFacts(input: Record<string, unknown>) {
  return collectManagedSiteContractV1Facts(input as unknown as ManagedSiteContractV1);
}

function assertCode(action: () => void, code: string): void {
  assert.throws(action, (error: unknown) => error instanceof ManagedSiteContractError && error.code === code);
}

function withKind(id: string, kind: "page" | "field" | "item" | "asset" | "alias"): string {
  return `${kind}_${id.slice(id.indexOf("_") + 1)}`;
}

function linkField(id: string, pageId: string): Record<string, unknown> {
  return {
    id,
    type: "link",
    scope: "page",
    classification: "customer_editable",
    capabilities: ["link.label.edit", "link.destination.edit", "link.target.edit"],
    resolver: { kind: "json_pointer", path: "content/site.json", pointer: "/hero/link" },
    usages: [{ pageId, itemId: null }],
    presentation: { name: "Link", description: null, group: "C3A", order: 1, example: id },
    constraints: {
      labelConstraints: { minLength: 1, maxLength: 80, newlines: "forbid" },
      authority: "internal_or_external",
      allowedSchemes: ["https"],
      allowedExternalHosts: ["example.com"],
      fragmentPolicy: "forbid",
      allowedFragments: [],
      allowedTargets: ["same_window"],
    },
  };
}

interface SourceField {
  readonly id: string;
  readonly resolver: { path: string; pointer: string };
}

function sourceField(contract: Record<string, unknown>, index: number): SourceField {
  const fields = mutableContract(contract).pages[0].sections[0].fields;
  return fields[index] as unknown as SourceField;
}

function assignExactSourceAlias(contract: Record<string, unknown>): void {
  const [first, second] = [sourceField(contract, 0), sourceField(contract, 1)];
  second.resolver.path = first.resolver.path;
  second.resolver.pointer = first.resolver.pointer;
}

function protectedSourceField(contract: Record<string, unknown>): SourceField {
  const protectedFields = (contract.internalSeo as { protectedFields: SourceField[] }).protectedFields;
  const first = protectedFields[0];
  assert.notEqual(first, undefined);
  return first;
}

function fieldItemIds(
  field: ManagedSiteContractV1["pages"][number]["sections"][number]["fields"][number],
): readonly string[] {
  return field.usages.flatMap((usage) =>
    usage.itemId === null ? [] : [usage.itemId],
  );
}

function expectedDeferredItems(
  contract: ManagedSiteContractV1,
): readonly string[] {
  return contract.pages.flatMap((page) =>
    page.sections.flatMap((section) => section.fields.flatMap(fieldItemIds)),
  );
}

function expectedSourceCount(contract: ManagedSiteContractV1): number {
  const pageFields = contract.pages.flatMap((page) =>
    page.sections.flatMap((section) => section.fields),
  );
  return (
    pageFields.length +
    contract.collections.length +
    contract.internalSeo.protectedFields.length
  );
}

describe("managed-site contract semantic facts", () => {
  it("classifies every C1 stable-ID occurrence in a conforming contract", () => {
    const parsed = parseManagedSiteContractV1(conformingContract());
    const facts = collectManagedSiteContractV1Facts(parsed);
    const occurrences = collectManagedSiteContractOccurrences(parsed);

    assert.deepEqual(facts.deferred.itemIds, expectedDeferredItems(parsed));
    assert.equal(
      facts.declarations.length,
      occurrences.filter((occurrence) => occurrence.role === "declaration").length,
    );
    assert.equal(
      facts.references.length,
      occurrences.filter((occurrence) => occurrence.role === "reference").length,
    );
    assert.equal(facts.sources.length, expectedSourceCount(parsed));
    assert.equal(
      facts.routes.length,
      parsed.pages.length + parsed.internalSeo.redirects.length,
    );
  });

  it("classifies variant-only collection item asset references", () => {
    const contract = conformingContract();
    const collection = (contract.collections as Array<{
      itemFields: Array<Record<string, unknown>>;
    }>)[0];
    const imageFieldId = fixtureId("field");
    const assetId = (contract.assets as Array<{ id: string }>)[0].id;
    collection.itemFields.push({
      id: imageFieldId,
      type: "image",
      classification: "customer_editable",
      capabilities: ["image.upload"],
      itemPointer: "/image",
      presentation: { name: "Image", description: null, group: "C3A", order: 1, example: null },
      assetSlotId: assetId,
    });
    const facts = contractFacts(contract);
    assert.equal(
      facts.references.some((fact) =>
        fact.id === assetId &&
        fact.location ===
          `collections[0].itemFields[${collection.itemFields.length - 1}].assetSlotId`),
      true,
    );
  });

  it("classifies common link leaves once without scanning presentation JSON", () => {
    const contract = conformingContract();
    const page = (contract.pages as Array<{
      id: string;
      sections: Array<{ fields: Array<Record<string, unknown>> }>;
    }>)[0];
    const id = fixtureId("field");
    page.sections[0].fields.push(linkField(id, page.id));
    const occurrences = collectManagedSiteContractOccurrences(parseManagedSiteContractV1(contract));
    assert.equal(occurrences.filter((occurrence) => occurrence.id === id).length, 1);
  });

  it("classifies present nullable and nested SEO references", () => {
    const contract = conformingContract();
    const seo = contract.internalSeo as {
      businessIdentity: { email: string | null };
      pages: Array<{
        breadcrumbParentPageId: string | null;
        metadata: { social: { title: string | null } };
      }>;
      protectedFields: Array<{ id: string }>;
    };
    const fieldId = seo.protectedFields[0].id;
    const pageId = (contract.pages as Array<{ id: string }>)[1].id;
    seo.businessIdentity.email = fieldId;
    seo.pages[0].metadata.social.title = fieldId;
    seo.pages[0].breadcrumbParentPageId = pageId;
    const locations = collectManagedSiteContractOccurrences(parseManagedSiteContractV1(contract))
      .map((occurrence) => occurrence.location);
    for (const location of [
      "internalSeo.businessIdentity.email",
      "internalSeo.pages[0].metadata.social.title",
      "internalSeo.pages[0].breadcrumbParentPageId",
      "internalSeo.pages[0].internalLinks.requiredPageIds[0]",
    ]) assert.equal(locations.includes(location), true);
  });
});

describe("managed-site contract occurrence registry", () => {
  for (const path of [
    "pages[].sections[].fields[type=plain_text].id",
    "pages[].sections[].fields[type=link].id",
    "pages[].sections[].fields[type=image].id",
    "pages[].sections[].fields[type=image].assetSlotId",
    "collections[].itemFields[type=image].assetSlotId",
    "pages[].route[kind=generated].routeKeyFieldId",
    "internalSeo.pages[].metadata.social.title",
    "internalSeo.businessIdentity.email",
    "internalSeo.pages[].internalLinks.requiredPageIds[]",
    "internalSeo.protectedFields[type=internal_protected].usages[].itemId",
    "internalSeo.redirects[].destination[kind=page].pageId",
  ]) {
    it(`fails closed when ${path} is unclassified`, () => {
      const registry = MANAGED_SITE_CONTRACT_OCCURRENCE_REGISTRY.filter(
        (entry) => entry.path !== path,
      );
      assertCode(
        () => collectManagedSiteContractOccurrences(
          parseManagedSiteContractV1(conformingContract()),
          registry,
        ),
        "CONTRACT_OCCURRENCE_UNCLASSIFIED",
      );
    });
  }

  it("fails closed when one occurrence path is classified twice", () => {
    const first = MANAGED_SITE_CONTRACT_OCCURRENCE_REGISTRY[0];
    assert.notEqual(first, undefined);
    assertCode(
      () => collectManagedSiteContractOccurrences(
        parseManagedSiteContractV1(conformingContract()),
        [...MANAGED_SITE_CONTRACT_OCCURRENCE_REGISTRY, first],
      ),
      "CONTRACT_OCCURRENCE_CLASSIFIED_TWICE",
    );
  });

  it("uses one deliberate all-kinds tombstone rule", () => {
    const rules = MANAGED_SITE_CONTRACT_OCCURRENCE_REGISTRY.filter(
      (entry) => entry.path === "tombstonedIds[]",
    );
    assert.deepEqual(rules.map(({ idKind, role }) => ({ idKind, role })), [
      { idKind: "actual", role: "tombstone" },
    ]);
  });

  it("uses one safe grammar for runtime path tokens", () => {
    for (const token of [".", "]", "#", "=", "[", ""]) {
      assert.equal(isManagedSiteOccurrencePathToken(token), false);
    }
    for (const token of ["fieldId", "plain_text", "generated", "0"]) {
      assert.equal(isManagedSiteOccurrencePathToken(token), true);
    }
  });
});

describe("managed-site contract identity facts", () => {
  it("accepts globally unique live declarations and contract-local references", () => {
    assert.doesNotThrow(() => validateManagedSiteContractIdentityFacts(contractFacts(conformingContract())));
  });

  for (const { name, mutate, code } of [
    { name: "rejects duplicate live declarations", mutate: (contract: Record<string, unknown>) => { const data = mutableContract(contract); data.pages[1].id = data.pages[0].id; }, code: "CONTRACT_ID_DUPLICATE" },
    { name: "rejects cross-kind live declaration entropy", mutate: (contract: Record<string, unknown>) => { const data = mutableContract(contract); data.collections[0].id = `collection_${data.pages[0].id.slice(5)}`; }, code: "CONTRACT_ID_CROSS_KIND_COLLISION" },
    { name: "rejects a live declaration that is tombstoned", mutate: (contract: Record<string, unknown>) => { const data = mutableContract(contract); data.tombstonedIds = [data.pages[0].sections[0].fields[0].id]; }, code: "CONTRACT_ID_TOMBSTONED" },
    { name: "rejects duplicate tombstones", mutate: (contract: Record<string, unknown>) => { const data = mutableContract(contract); const id = fixtureId("item"); data.tombstonedIds = [id, id]; }, code: "CONTRACT_TOMBSTONE_DUPLICATE" },
    { name: "rejects unresolved references", mutate: (contract: Record<string, unknown>) => { mutableContract(contract).pages[1].route.collectionId = fixtureId("collection"); }, code: "CONTRACT_REFERENCE_UNRESOLVED" },
    { name: "rejects tombstoned references", mutate: (contract: Record<string, unknown>) => { const data = mutableContract(contract); const id = fixtureId("collection"); data.pages[1].route.collectionId = id; data.tombstonedIds = [id]; }, code: "CONTRACT_REFERENCE_TOMBSTONED" },
    { name: "rejects collection route keys declared outside their collection", mutate: (contract: Record<string, unknown>) => { const data = mutableContract(contract); data.pages[1].route.routeKeyFieldId = data.pages[0].sections[0].fields[0].id; }, code: "CONTRACT_REFERENCE_SCOPE" },
    { name: "rejects repeated fields in one alias group", mutate: (contract: Record<string, unknown>) => { const group = mutableContract(contract).atomicAliasGroups[0]; group.fieldIds = [group.fieldIds[0], group.fieldIds[0]]; }, code: "CONTRACT_ALIAS_FIELD_DUPLICATE" },
    { name: "rejects fields shared by alias groups", mutate: (contract: Record<string, unknown>) => { const data = mutableContract(contract); data.atomicAliasGroups.push({ id: fixtureId("alias"), fieldIds: [data.atomicAliasGroups[0].fieldIds[0]] }); }, code: "CONTRACT_ALIAS_FIELD_OVERLAP" },
  ]) {
    it(name, () => {
      const contract = conformingContract();
      mutate(contract);
      assertCode(() => validateManagedSiteContractIdentityFacts(contractFacts(contract)), code);
    });
  }

  it("rejects wrong-kind references even when an unsafe caller bypasses C2", () => {
    const contract = conformingContract();
    const data = mutableContract(contract);
    data.pages[1].route.collectionId = data.pages[0].id;
    assertCode(() => validateManagedSiteContractIdentityFacts(unsafeContractFacts(contract)), "CONTRACT_REFERENCE_KIND");
  });

  for (const { name, liveId, tombstoneId, code } of [
    { name: "page exact overlap", liveId: (data: MutableContract) => data.pages[0].id, tombstoneId: (id: string) => id, code: "CONTRACT_ID_TOMBSTONED" },
    { name: "asset exact overlap", liveId: (data: MutableContract) => data.assets[0].id, tombstoneId: (id: string) => id, code: "CONTRACT_ID_TOMBSTONED" },
    { name: "live page to tombstoned item entropy", liveId: (data: MutableContract) => data.pages[0].id, tombstoneId: (id: string) => withKind(id, "item"), code: "CONTRACT_ID_CROSS_KIND_COLLISION" },
    { name: "live field to tombstoned page entropy", liveId: (data: MutableContract) => data.pages[0].sections[0].fields[0].id, tombstoneId: (id: string) => withKind(id, "page"), code: "CONTRACT_ID_CROSS_KIND_COLLISION" },
    { name: "live asset to tombstoned page entropy", liveId: (data: MutableContract) => data.assets[0].id, tombstoneId: (id: string) => withKind(id, "page"), code: "CONTRACT_ID_CROSS_KIND_COLLISION" },
    { name: "live alias to tombstoned asset entropy", liveId: (data: MutableContract) => data.atomicAliasGroups[0].id, tombstoneId: (id: string) => withKind(id, "asset"), code: "CONTRACT_ID_CROSS_KIND_COLLISION" },
  ]) {
    it(`uses one live/tombstone registry for ${name}`, () => {
      const contract = conformingContract();
      const data = mutableContract(contract);
      data.tombstonedIds = [tombstoneId(liveId(data))];
      assertCode(() => validateManagedSiteContractIdentityFacts(contractFacts(contract)), code);
    });
  }

  it("uses one registry for cross-kind tombstone entropy", () => {
    const contract = conformingContract();
    const id = fixtureId("item");
    mutableContract(contract).tombstonedIds = [id, withKind(id, "page")];
    assertCode(
      () => validateManagedSiteContractIdentityFacts(contractFacts(contract)),
      "CONTRACT_ID_CROSS_KIND_COLLISION",
    );
  });
});

describe("managed-site contract source and route facts", () => {
  it("accepts disjoint source regions and routes", () => {
    const facts = contractFacts(conformingContract());
    assert.doesNotThrow(() => validateManagedSiteContractSourceFacts(facts));
    assert.doesNotThrow(() => validateManagedSiteContractRouteFacts(facts));
  });

  for (const { name, mutate, code } of [
    { name: "allows exact source aliases for fields in one group", mutate: (contract: Record<string, unknown>) => assignExactSourceAlias(contract), code: null },
    { name: "rejects exact source aliases without a group", mutate: (contract: Record<string, unknown>) => { assignExactSourceAlias(contract); mutableContract(contract).atomicAliasGroups.length = 0; }, code: "CONTRACT_SOURCE_POINTER_OVERLAP" },
    { name: "rejects exact source aliases across different groups", mutate: (contract: Record<string, unknown>) => { assignExactSourceAlias(contract); const data = mutableContract(contract); data.atomicAliasGroups[0].fieldIds = [sourceField(contract, 0).id]; data.atomicAliasGroups.push({ id: fixtureId("alias"), fieldIds: [sourceField(contract, 1).id] }); }, code: "CONTRACT_SOURCE_POINTER_OVERLAP" },
    { name: "rejects exact source aliases when group membership is split", mutate: (contract: Record<string, unknown>) => { assignExactSourceAlias(contract); const data = mutableContract(contract); data.atomicAliasGroups.push({ id: fixtureId("alias"), fieldIds: [sourceField(contract, 1).id] }); }, code: "CONTRACT_SOURCE_POINTER_OVERLAP" },
    { name: "rejects a same-group source ancestor", mutate: (contract: Record<string, unknown>) => { const [first, second] = [sourceField(contract, 0), sourceField(contract, 1)]; first.resolver.pointer = "/atomic"; second.resolver.pointer = "/atomic/child"; }, code: "CONTRACT_SOURCE_POINTER_OVERLAP" },
    { name: "rejects a same-group source descendant", mutate: (contract: Record<string, unknown>) => { const [first, second] = [sourceField(contract, 0), sourceField(contract, 1)]; first.resolver.pointer = "/atomic/child"; second.resolver.pointer = "/atomic"; }, code: "CONTRACT_SOURCE_POINTER_OVERLAP" },
    { name: "allows same-group fields with distinct sources", mutate: (contract: Record<string, unknown>) => { const [first, second] = [sourceField(contract, 0), sourceField(contract, 1)]; first.resolver.pointer = "/atomic/title"; second.resolver.pointer = "/atomic/body"; }, code: null },
    { name: "rejects a field and collection sharing an exact source", mutate: (contract: Record<string, unknown>) => { const field = sourceField(contract, 0); const collection = (contract.collections as Array<{ resolver: { path: string; pointer: string } }>)[0]; field.resolver.pointer = "/shared"; collection.resolver.pointer = "/shared"; }, code: "CONTRACT_SOURCE_POINTER_OVERLAP" },
    { name: "rejects a protected field sharing a group source", mutate: (contract: Record<string, unknown>) => { const field = sourceField(contract, 0); const protectedField = protectedSourceField(contract); field.resolver.pointer = "/shared"; protectedField.resolver.pointer = "/shared"; mutableContract(contract).atomicAliasGroups[0].fieldIds = [field.id, protectedField.id]; }, code: "CONTRACT_SOURCE_POINTER_OVERLAP" },
    { name: "rejects canonical path aliases despite an alias group", mutate: (contract: Record<string, unknown>) => { assignExactSourceAlias(contract); sourceField(contract, 1).resolver.path = "CONTENT/site.json"; }, code: "CONTRACT_SOURCE_PATH_ALIAS" },
    { name: "treats escaped separators as pointer text rather than ancestry", mutate: (contract: Record<string, unknown>) => { const [first, second] = [sourceField(contract, 0), sourceField(contract, 1)]; first.resolver.pointer = "/atomic~1title"; second.resolver.pointer = "/atomic"; }, code: null },
  ] as const) {
    it(name, () => {
      const contract = conformingContract();
      mutate(contract);
      if (code === null) {
        assert.doesNotThrow(() => validateManagedSiteContractSourceFacts(contractFacts(contract)));
        return;
      }
      assertCode(() => validateManagedSiteContractSourceFacts(contractFacts(contract)), code);
    });
  }

  for (const { name, mutate, code, validate } of [
    { name: "rejects case-alias source paths", mutate: (contract: Record<string, unknown>) => { const data = mutableContract(contract); const field = data.pages[0].sections[0].fields[0] as unknown as { resolver: { path: string } }; field.resolver.path = "CONTENT/site.json"; }, code: "CONTRACT_SOURCE_PATH_ALIAS", validate: validateManagedSiteContractSourceFacts },
    { name: "rejects ancestor source pointers", mutate: (contract: Record<string, unknown>) => { const data = mutableContract(contract); const field = data.pages[0].sections[0].fields[1] as unknown as { resolver: { pointer: string } }; field.resolver.pointer = "/hero"; }, code: "CONTRACT_SOURCE_POINTER_OVERLAP", validate: validateManagedSiteContractSourceFacts },
    { name: "rejects root source pointers", mutate: (contract: Record<string, unknown>) => { const data = mutableContract(contract); const field = data.pages[0].sections[0].fields[1] as unknown as { resolver: { pointer: string } }; field.resolver.pointer = ""; }, code: "CONTRACT_SOURCE_POINTER_OVERLAP", validate: validateManagedSiteContractSourceFacts },
    { name: "rejects equal source pointers outside an alias group", mutate: (contract: Record<string, unknown>) => { sourceField(contract, 2).resolver.pointer = "/hero/title"; }, code: "CONTRACT_SOURCE_POINTER_OVERLAP", validate: validateManagedSiteContractSourceFacts },
    { name: "rejects generated routes colliding with static routes", mutate: (contract: Record<string, unknown>) => { mutableContract(contract).pages[0].route.path = "/services/x"; }, code: "CONTRACT_ROUTE_COLLISION", validate: validateManagedSiteContractRouteFacts },
    { name: "rejects redirects colliding with generated routes", mutate: (contract: Record<string, unknown>) => { const redirects = (contract.internalSeo as { redirects: Array<{ fromPath: string }> }).redirects; redirects[0].fromPath = "/services/x"; }, code: "CONTRACT_ROUTE_COLLISION", validate: validateManagedSiteContractRouteFacts },
  ]) {
    it(name, () => {
      const contract = conformingContract();
      mutate(contract);
      assertCode(() => validate(contractFacts(contract)), code);
    });
  }
});
