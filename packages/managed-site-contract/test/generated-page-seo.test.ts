import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ManagedSiteContractError,
  parseManagedSiteContentDocument,
  parseManagedSiteContractV1,
  validateManagedSiteContractV1ContentSemantics,
  validateManagedSiteContractV1Semantics,
  type ManagedGeneratedPageSeoDescriptor,
} from "../src/index.js";
import {
  generatedSeoContentFixture,
  generatedSeoContractFixture,
} from "./generated-page-seo-fixture.js";
import { fixtureId } from "./contract-semantics-fixture.js";

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Expected object");
  }
  return value as JsonObject;
}

function array(value: unknown): JsonObject[] {
  if (!Array.isArray(value)) throw new Error("Expected array");
  return value as JsonObject[];
}

function seo(contract: JsonObject): JsonObject {
  return object(contract.internalSeo);
}

function generated(contract: JsonObject): JsonObject {
  const descriptor = array(seo(contract).generatedPages)[0];
  if (descriptor === undefined) throw new Error("Missing generated SEO descriptor");
  return descriptor;
}

function expectCode(action: () => unknown, code: string): void {
  assert.throws(action, (error: unknown) => {
    assert.ok(error instanceof ManagedSiteContractError);
    assert.equal(error.code, code);
    return true;
  });
}

function validateContract(contract: JsonObject): void {
  validateManagedSiteContractV1Semantics(parseManagedSiteContractV1(contract));
}

function validateContent(contract: JsonObject, content: JsonObject | null): void {
  if (content === null) throw new Error("Missing content fixture");
  validateManagedSiteContractV1ContentSemantics(
    parseManagedSiteContractV1(contract),
    parseManagedSiteContentDocument(content),
  );
}

function compileGeneratedSeo(value: ManagedGeneratedPageSeoDescriptor): string {
  return value.collectionId;
}
void compileGeneratedSeo;

describe("managed-site generated-page SEO", () => {
  it("accepts one exact generated descriptor per generated route", () => {
    const fixture = generatedSeoContractFixture();
    assert.doesNotThrow(() => validateContract(fixture.contract));
  });

  it("requires complete and route-correct static/generated coverage", () => {
    const cases = [
      {
        code: "CONTRACT_SEO_PAGE_COVERAGE",
        mutate: (contract: JsonObject) => {
          seo(contract).generatedPages = [];
        },
      },
      {
        code: "CONTRACT_SEO_PAGE_DUPLICATE",
        mutate: (contract: JsonObject) => {
          const descriptors = array(seo(contract).generatedPages);
          descriptors.push(structuredClone(descriptors[0]));
        },
      },
      {
        code: "CONTRACT_SEO_PAGE_ROUTE",
        mutate: (contract: JsonObject) => {
          generated(contract).pageId = array(contract.pages)[0].id;
        },
      },
      {
        code: "CONTRACT_SEO_PAGE_ROUTE",
        mutate: (contract: JsonObject) => {
          array(seo(contract).pages)[0].pageId = generated(contract).pageId;
        },
      },
      {
        code: "CONTRACT_REFERENCE_UNRESOLVED",
        mutate: (contract: JsonObject) => {
          generated(contract).collectionId = fixtureId("collection");
        },
      },
    ];
    for (const { code, mutate } of cases) {
      const fixture = generatedSeoContractFixture();
      mutate(fixture.contract);
      expectCode(() => validateContract(fixture.contract), code);
    }
  });

  it("binds generated metadata and route keys to protected typed item fields", () => {
    const cases = [
      {
        mutate: (contract: JsonObject) => {
          const collection = array(contract.collections)[0];
          const routeKey = array(collection.itemFields).find(
            (field) => field.semantic === "route.slug",
          );
          if (routeKey === undefined) throw new Error("Missing route key");
          object(generated(contract).metadata).title = routeKey.id;
        },
      },
      {
        mutate: (contract: JsonObject) => {
          const collection = array(contract.collections)[0];
          const canonical = array(collection.itemFields).find(
            (field) => field.id === object(generated(contract).metadata).canonical,
          );
          if (canonical === undefined) throw new Error("Missing canonical field");
          canonical.valueType = "string";
        },
      },
      {
        mutate: (contract: JsonObject) => {
          const page = array(contract.pages).find(
            (candidate) => candidate.id === generated(contract).pageId,
          );
          const route = object(page?.route);
          const collection = array(contract.collections)[0];
          const routeKey = array(collection.itemFields).find(
            (field) => field.id === route.routeKeyFieldId,
          );
          if (routeKey === undefined) throw new Error("Missing route key");
          routeKey.semantic = "seo.title";
        },
      },
      {
        mutate: (contract: JsonObject) => {
          generated(contract).primaryImageFieldId = object(
            generated(contract).metadata,
          ).title;
        },
      },
      {
        mutate: (contract: JsonObject) => {
          const homeField = array(array(contract.pages)[0].sections).flatMap(
            (section) => array(section.fields),
          )[0];
          if (homeField === undefined) throw new Error("Missing home field");
          array(generated(contract).jsonLd)[0].siteSourceFieldIds = [homeField.id];
        },
      },
      {
        mutate: (contract: JsonObject) => {
          array(array(contract.collections)[0].uniqueness).splice(0);
        },
      },
    ];
    for (const { mutate } of cases) {
      const fixture = generatedSeoContractFixture();
      mutate(fixture.contract);
      expectCode(() => validateContract(fixture.contract), "CONTRACT_SEO_FIELD_POLICY");
    }
  });

  it("requires one route parameter and one exact generated H1", () => {
    const cases = [
      {
        code: "CONTRACT_SEO_ROUTE_PATTERN",
        mutate: (contract: JsonObject) => {
          const page = array(contract.pages).find(
            (candidate) => candidate.id === generated(contract).pageId,
          );
          object(page?.route).pattern = "/[location]/services/[slug]";
        },
      },
      {
        code: "CONTRACT_SEO_FIELD_POLICY",
        mutate: (contract: JsonObject) => {
          generated(contract).headingOutline = [];
        },
      },
      {
        code: "CONTRACT_SEO_FIELD_POLICY",
        mutate: (contract: JsonObject) => {
          const outline = array(generated(contract).headingOutline);
          outline.push(structuredClone(outline[0]));
        },
      },
    ];
    for (const { code, mutate } of cases) {
      const fixture = generatedSeoContractFixture();
      mutate(fixture.contract);
      expectCode(() => validateContract(fixture.contract), code);
    }
  });

  it("rejects non-canonical active generated slugs", () => {
    for (const slug of [
      "Service One",
      "service_one",
      "service--one",
      "service/one",
      "a".repeat(201),
    ]) {
      const fixture = generatedSeoContentFixture();
      if (fixture.content === null) throw new Error("Missing content fixture");
      const routeValue = array(fixture.content.values).find(
        (value) => value.fieldId === fixture.ids.routeKey,
      );
      if (routeValue === undefined) throw new Error("Missing route value");
      routeValue.value = slug;
      expectCode(
        () => validateContent(fixture.contract, fixture.content),
        "CONTENT_GENERATED_ROUTE_KEY",
      );
    }
    const boundary = generatedSeoContentFixture();
    const content = boundary.content;
    if (content === null) throw new Error("Missing content fixture");
    const routeValue = array(content.values).find(
      (value) => value.fieldId === boundary.ids.routeKey,
    );
    if (routeValue === undefined) throw new Error("Missing route value");
    routeValue.value = "a".repeat(200);
    assert.doesNotThrow(() => validateContent(boundary.contract, content));
  });
});
