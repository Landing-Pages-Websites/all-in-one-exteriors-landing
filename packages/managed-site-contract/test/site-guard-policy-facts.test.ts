import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ManagedSiteContractError,
  deriveManagedSiteGuardContractFactsV1,
  deriveManagedSiteGuardPolicyFactsV1,
  parseManagedSiteContentDocument,
  parseManagedSiteContractV1,
  type ManagedSiteGuardPolicyFactsV1,
} from "../src/index.js";
import { assetFacts } from "../src/site-guard-policy-facts.js";
import {
  contentSemanticsFixture,
  type ContentSemanticsFixture,
} from "./content-semantics-fixture.js";
import { fixtureId } from "./contract-semantics-fixture.js";

type JsonObject = Record<string, unknown>;

function objects(value: unknown): JsonObject[] {
  return value as JsonObject[];
}

function object(value: unknown): JsonObject {
  return value as JsonObject;
}

function parsed(fixture = contentSemanticsFixture()) {
  return {
    contract: parseManagedSiteContractV1(fixture.contract),
    content: parseManagedSiteContentDocument(fixture.content),
  };
}

function derive(fixture = contentSemanticsFixture()) {
  const value = parsed(fixture);
  return deriveManagedSiteGuardPolicyFactsV1(value.contract, value.content);
}

function fields(fixture: ContentSemanticsFixture): JsonObject[] {
  return objects(objects(fixture.contract.pages)[0].sections).flatMap(
    (section) => objects(section.fields),
  );
}

function setFieldSourcePath(
  fixture: ContentSemanticsFixture,
  fieldId: string,
  path: string,
): void {
  const field = fields(fixture).find((candidate) => candidate.id === fieldId);
  assert.notEqual(field, undefined);
  object(field?.resolver).path = path;
}

function addReferencedAsset(
  fixture: ContentSemanticsFixture,
  material: Partial<JsonObject> = {},
): string {
  const assets = objects(fixture.contract.assets);
  const asset = structuredClone(assets[0]);
  asset.id = fixtureId("asset");
  if (typeof material.bytes === "number") asset.maxBytes = material.bytes;
  assets.push(asset);

  const internalSeo = object(fixture.contract.internalSeo);
  const page = objects(internalSeo.pages)[0];
  object(object(page.metadata).social).image = asset.id;

  const manifest = structuredClone(objects(fixture.content.assetManifest)[0]);
  manifest.assetSlotId = asset.id;
  Object.assign(manifest, material);
  objects(fixture.content.assetManifest).push(manifest);
  return asset.id as string;
}

function expectCode(action: () => unknown, code: string): void {
  assert.throws(action, (error: unknown) => {
    assert.ok(error instanceof ManagedSiteContractError);
    assert.equal(error.code, code);
    return true;
  });
}

function assertDeepFrozen(value: unknown, seen = new Set<object>()): void {
  if (value === null || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeepFrozen(child, seen);
}

function assertReadonly(result: ManagedSiteGuardPolicyFactsV1): void {
  // @ts-expect-error Guard policy source facts are readonly
  result.sourcePaths.push("content/other.json");
  // @ts-expect-error Guard policy asset facts are readonly
  result.assets[0].bytes = 2;
}
void assertReadonly;

describe("managed-site Guard policy facts", () => {
  it("derives deterministic source discovery before content files are loaded", () => {
    const fixture = contentSemanticsFixture();
    setFieldSourcePath(
      fixture,
      fixture.ids.linkField,
      "content/pages/home.json",
    );
    const contract = parseManagedSiteContractV1(fixture.contract);

    assert.deepEqual(deriveManagedSiteGuardContractFactsV1(contract), {
      sourcePaths: ["content/pages/home.json", "content/site.json"],
    });
  });

  it("projects exact sorted source and material asset facts", () => {
    const fixture = contentSemanticsFixture();
    setFieldSourcePath(
      fixture,
      fixture.ids.linkField,
      "content/pages/home.json",
    );
    addReferencedAsset(fixture, {
      path: "public/images/another.webp",
      sha256: "b".repeat(64),
      bytes: 2,
    });

    assert.deepEqual(derive(fixture), {
      sourcePaths: ["content/pages/home.json", "content/site.json"],
      assets: [
        {
          path: "public/images/another.webp",
          sha256: "b".repeat(64),
          bytes: 2,
        },
        {
          path: "public/images/managed.webp",
          sha256: "a".repeat(64),
          bytes: 1,
        },
      ],
    });
  });

  it("deduplicates identical shared asset material and ignores input order", () => {
    const fixture = contentSemanticsFixture();
    addReferencedAsset(fixture);
    const first = derive(fixture);
    fixture.content.assetManifest = objects(
      fixture.content.assetManifest,
    ).reverse();

    assert.deepEqual(first.assets, [
      {
        path: "public/images/managed.webp",
        sha256: "a".repeat(64),
        bytes: 1,
      },
    ]);
    assert.deepEqual(derive(fixture), first);
    assertDeepFrozen(first);
  });

  for (const testCase of [
    {
      name: "conflicting material at one asset path",
      mutate(fixture: ContentSemanticsFixture) {
        addReferencedAsset(fixture, { sha256: "b".repeat(64) });
      },
      // Content semantics now refuses one path with two materials before Guard
      // facts are derived, since the manifest is keyed by path.
      code: "CONTENT_ASSET_PATH_CONFLICT",
    },
    {
      name: "case-aliased asset paths",
      mutate(fixture: ContentSemanticsFixture) {
        // Case-aliased inside public/: an asset path must be served (0.12.0),
        // so the alias the Guard refuses has to be one too.
        addReferencedAsset(fixture, { path: "public/images/MANAGED.webp" });
      },
      code: "GUARD_POLICY_PATH_AMBIGUOUS",
    },
    {
      name: "a source file reused as an asset",
      mutate(fixture: ContentSemanticsFixture) {
        // The source moves onto the asset's path: an asset must be served, so
        // the asset cannot move onto a source's.
        for (const field of fields(fixture)) {
          object(field.resolver).path = "public/images/managed.webp";
        }
      },
      code: "GUARD_POLICY_PATH_AMBIGUOUS",
    },
    {
      name: "a source file masking an asset directory",
      mutate(fixture: ContentSemanticsFixture) {
        for (const field of fields(fixture)) {
          object(field.resolver).path = "public/images";
        }
        const internalSeo = object(fixture.contract.internalSeo);
        for (const field of objects(internalSeo.protectedFields)) {
          object(field.resolver).path = "public/images";
        }
        for (const collection of objects(fixture.contract.collections)) {
          object(collection.resolver).path = "public/images";
        }
      },
      code: "GUARD_POLICY_PATH_AMBIGUOUS",
    },
  ]) {
    it(`rejects ${testCase.name}`, () => {
      const fixture = contentSemanticsFixture();
      testCase.mutate(fixture);
      expectCode(() => derive(fixture), testCase.code);
    });
  }

  it("fails contract semantics before exposing discovery facts", () => {
    const fixture = contentSemanticsFixture();
    objects(fixture.contract.pages)[1].id = objects(
      fixture.contract.pages,
    )[0].id;
    const contract = parseManagedSiteContractV1(fixture.contract);

    expectCode(
      () => deriveManagedSiteGuardContractFactsV1(contract),
      "CONTRACT_ID_DUPLICATE",
    );
  });

  it("rejects source files that mask another source directory", () => {
    const fixture = contentSemanticsFixture();
    setFieldSourcePath(fixture, fixture.ids.linkField, "content");
    const contract = parseManagedSiteContractV1(fixture.contract);

    expectCode(
      () => deriveManagedSiteGuardContractFactsV1(contract),
      "GUARD_POLICY_PATH_AMBIGUOUS",
    );
  });

  it("fails content semantics before exposing asset facts", () => {
    const fixture = contentSemanticsFixture();
    fixture.content.assetManifest = [];

    expectCode(() => derive(fixture), "CONTENT_ASSET_MANIFEST_MISSING");
  });

  describe("Guard asset facts on their own", () => {
    function entry(material: Partial<JsonObject> = {}): JsonObject {
      return {
        assetSlotId: fixtureId("asset"),
        path: "public/images/managed.webp",
        sha256: "a".repeat(64),
        mimeType: "image/webp",
        width: 1200,
        height: 600,
        bytes: 1,
        ...material,
      };
    }
    function facts(entries: JsonObject[]) {
      // Deliberately skips content validation, which would refuse first.
      return assetFacts({ schemaVersion: "1.0", values: [], assetManifest: entries } as never);
    }

    it("deduplicates one path with identical material under two slots", () => {
      assert.deepEqual(facts([entry(), entry()]), [
        { path: "public/images/managed.webp", sha256: "a".repeat(64), bytes: 1 },
      ]);
    });

    for (const [field, value] of [
      ["sha256", "b".repeat(64)],
      ["mimeType", "image/avif"],
      ["width", 1000],
      ["height", 500],
      ["bytes", 2],
    ] as const) {
      it(`refuses one path whose ${field} differs`, () => {
        expectCode(() => facts([entry(), entry({ [field]: value })]), "GUARD_ASSET_PATH_CONFLICT");
      });
    }
  });
});
