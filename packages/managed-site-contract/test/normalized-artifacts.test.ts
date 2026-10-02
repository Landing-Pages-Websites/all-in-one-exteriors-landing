import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";

import {
  ManagedSiteContractError,
  canonicalizeJson,
  digestCanonicalJson,
  normalizeManagedSiteArtifactsV1,
  parseManagedSiteContentDocument,
  parseManagedSiteContractV1,
  type ManagedSiteContentDocument,
  type ManagedSiteContractV1,
  type ManagedSiteNormalizedArtifactsV1,
} from "../src/index.js";
import {
  contentSemanticsFixture,
  type ContentSemanticsFixture,
} from "./content-semantics-fixture.js";
import { fixtureId } from "./contract-semantics-fixture.js";

type JsonObject = Record<string, unknown>;

interface ParsedFixture {
  readonly contract: ManagedSiteContractV1;
  readonly content: ManagedSiteContentDocument;
}

function objects(value: unknown): JsonObject[] {
  return value as JsonObject[];
}

function object(value: unknown): JsonObject {
  return value as JsonObject;
}

function parseFixture(fixture = contentSemanticsFixture()): ParsedFixture {
  return {
    contract: parseManagedSiteContractV1(fixture.contract),
    content: parseManagedSiteContentDocument(fixture.content),
  };
}

function normalized(fixture = contentSemanticsFixture()): ManagedSiteNormalizedArtifactsV1 {
  const parsed = parseFixture(fixture);
  return normalizeManagedSiteArtifactsV1(parsed.contract, parsed.content);
}

function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function addSeoOnlyAsset(fixture: ContentSemanticsFixture): void {
  const assets = objects(fixture.contract.assets);
  const asset = structuredClone(assets[0]);
  asset.id = fixtureId("asset");
  assets.push(asset);

  const seo = object(fixture.contract.internalSeo);
  const seoPage = objects(seo.pages)[0];
  object(object(seoPage.metadata).social).image = asset.id;

  const manifest = structuredClone(objects(fixture.content.assetManifest)[0]);
  manifest.assetSlotId = asset.id;
  objects(fixture.content.assetManifest).push(manifest);
}

function assertDeepFrozen(value: unknown, seen = new Set<object>()): void {
  if (value === null || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeepFrozen(child, seen);
}

function assertDeepReadonlyArtifact(
  artifact: ManagedSiteNormalizedArtifactsV1,
): void {
  // @ts-expect-error normalized artifact roots are readonly
  artifact.contract = artifact.contract;
  // @ts-expect-error normalized contract metadata is readonly
  artifact.contract.contractSha256 = "a".repeat(64);
  // @ts-expect-error normalized content metadata is readonly
  artifact.content.assetManifestSha256 = "a".repeat(64);
}
void assertDeepReadonlyArtifact;

describe("normalized managed-site artifacts", () => {
  it("returns exact canonical contract, content, and asset-manifest text", () => {
    const parsed = parseFixture();
    const artifacts = normalizeManagedSiteArtifactsV1(
      parsed.contract,
      parsed.content,
    );

    assert.deepEqual(artifacts.contract, {
      schemaVersion: "1.0",
      adapterKind: parsed.contract.adapter.kind,
      adapterVersion: parsed.contract.adapter.adapterVersion,
      canonicalContractJson: canonicalizeJson(parsed.contract),
      contractSha256: sha256Text(canonicalizeJson(parsed.contract)),
    });
    assert.deepEqual(artifacts.content, {
      schemaVersion: "1.0",
      canonicalContentJson: canonicalizeJson(parsed.content),
      contentSha256: sha256Text(canonicalizeJson(parsed.content)),
      canonicalAssetManifestJson: canonicalizeJson(parsed.content.assetManifest),
      assetManifestSha256: sha256Text(
        canonicalizeJson(parsed.content.assetManifest),
      ),
    });
  });

  it("uses registry-compatible raw text digests, not the legacy domain", () => {
    const parsed = parseFixture();
    const artifacts = normalizeManagedSiteArtifactsV1(
      parsed.contract,
      parsed.content,
    );

    assert.match(artifacts.contract.contractSha256, /^[a-f0-9]{64}$/u);
    assert.match(artifacts.content.contentSha256, /^[a-f0-9]{64}$/u);
    assert.match(artifacts.content.assetManifestSha256, /^[a-f0-9]{64}$/u);
    assert.notEqual(
      artifacts.contract.contractSha256,
      digestCanonicalJson(parsed.contract),
    );
  });

  it("emits reparseable bytes and a deeply frozen scalar result", () => {
    const parsed = parseFixture();
    const artifacts = normalizeManagedSiteArtifactsV1(
      parsed.contract,
      parsed.content,
    );

    assert.deepEqual(
      JSON.parse(artifacts.contract.canonicalContractJson),
      parsed.contract,
    );
    assert.deepEqual(
      JSON.parse(artifacts.content.canonicalContentJson),
      parsed.content,
    );
    assert.deepEqual(
      JSON.parse(artifacts.content.canonicalAssetManifestJson),
      parsed.content.assetManifest,
    );
    assertDeepFrozen(artifacts);
  });

  it("is independent of raw object property insertion order", () => {
    const first = contentSemanticsFixture();
    const clone = structuredClone(first);
    const second: ContentSemanticsFixture = {
      ...clone,
      contract: Object.fromEntries(Object.entries(clone.contract).reverse()),
      content: Object.fromEntries(Object.entries(clone.content).reverse()),
    };

    assert.deepEqual(normalized(first), normalized(second));
  });

  it("keeps valid content array order in exact revision identity", () => {
    const first = contentSemanticsFixture();
    const second = structuredClone(first);
    second.content.values = objects(second.content.values).reverse();

    const firstArtifacts = normalized(first);
    const secondArtifacts = normalized(second);
    assert.notEqual(
      firstArtifacts.content.canonicalContentJson,
      secondArtifacts.content.canonicalContentJson,
    );
    assert.notEqual(
      firstArtifacts.content.contentSha256,
      secondArtifacts.content.contentSha256,
    );
  });

  it("binds manifest-only order changes into both content identities", () => {
    const first = contentSemanticsFixture();
    addSeoOnlyAsset(first);
    const second = structuredClone(first);
    second.content.assetManifest = objects(second.content.assetManifest).reverse();

    const firstArtifacts = normalized(first);
    const secondArtifacts = normalized(second);
    assert.notEqual(
      firstArtifacts.content.contentSha256,
      secondArtifacts.content.contentSha256,
    );
    assert.notEqual(
      firstArtifacts.content.assetManifestSha256,
      secondArtifacts.content.assetManifestSha256,
    );
  });

  it("fails content semantics before returning trusted artifacts", () => {
    const fixture = contentSemanticsFixture();
    fixture.content.assetManifest = [];
    const parsed = parseFixture(fixture);

    assert.throws(
      () => normalizeManagedSiteArtifactsV1(parsed.contract, parsed.content),
      (error: unknown) =>
        error instanceof ManagedSiteContractError &&
        error.code === "CONTENT_ASSET_MANIFEST_MISSING",
    );
  });
});
