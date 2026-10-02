import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  bridgeSrcFor,
  CURRENT_BRIDGE_VERSION,
  parseManagedFieldDescriptor,
  parseManagedSiteContractV1,
  SUPPORTED_BRIDGE_VERSIONS,
  validateManagedFieldValue,
  validateManagedSiteContractV1JsonSchema,
} from "../src/index.js";
import {
  linkContentValue,
  linkField,
  managedSiteContract,
  stableId,
} from "./schema-fixtures.js";

const BRIDGE_SRC = bridgeSrcFor(CURRENT_BRIDGE_VERSION);

function withBridgeDelivery(patch: Record<string, unknown>): Record<string, unknown> {
  const contract = managedSiteContract();
  const bridge = contract.bridge as Record<string, unknown>;
  bridge.delivery = { ...(bridge.delivery as object), ...patch };
  return contract;
}

function withRoute(route: Record<string, unknown>): Record<string, unknown> {
  const contract = managedSiteContract();
  (contract.pages as Record<string, unknown>[])[0].route = route;
  return contract;
}

function generatedRoute(pattern: string): Record<string, unknown> {
  return {
    kind: "generated",
    pattern,
    collectionId: stableId("collection"),
    routeKeyFieldId: stableId("field"),
  };
}

describe("contract-local identity boundaries", () => {
  /**
   * Every supported version is accepted at its own src and nowhere else. The
   * refusals are derived per version, so promoting the next bridge adds its
   * near misses without anyone remembering to write them.
   */
  it("pins edit protocol 2 to each supported bridge at its own source", () => {
    assert.deepEqual([...SUPPORTED_BRIDGE_VERSIONS], ["v7", "v8", "v9", "v10"]);
    assert.equal(CURRENT_BRIDGE_VERSION, SUPPORTED_BRIDGE_VERSIONS.at(-1));
    for (const version of SUPPORTED_BRIDGE_VERSIONS) {
      const src = bridgeSrcFor(version);
      assert.equal(src, `https://app.gomega.ai/review-bridge/${version}/review-bridge.js`);
      assert.doesNotThrow(() =>
        parseManagedSiteContractV1(withBridgeDelivery({ version, src })),
      );
      for (const nearMiss of [
        `https://evil.example/review-bridge/${version}/review-bridge.js`,
        `https://app.gomega.ai.evil.example/review-bridge/${version}/review-bridge.js`,
        `https://app.gomega.ai/review-bridge/${version}/alternate.js`,
        `https://app.gomega.ai/review-bridge/${version}/review-bridge.min.js`,
        `https://app.gomega.ai/review-bridge/${version}/`,
        `https://app.gomega.ai/review-bridge/${version.toUpperCase()}/review-bridge.js`,
        `https://APP.gomega.ai/review-bridge/${version}/review-bridge.js`,
        `https://app.gomega.ai:443/review-bridge/${version}/review-bridge.js`,
        `https://app.gomega.ai//review-bridge/${version}/review-bridge.js`,
        `${src}?candidate=1`,
        `${src}#alternate`,
        `${src} `,
        `https://user@app.gomega.ai/review-bridge/${version}/review-bridge.js`,
        `http://app.gomega.ai/review-bridge/${version}/review-bridge.js`,
        // Every other version's asset, including the neighbours: a v10 descriptor
        // loading v9's file, or a v9 descriptor loading v10's, names one runtime
        // and delivers another.
        ...["v3", "v4", "v6", "v7", "v8", "v9", "v10", "v11"]
          .filter((other) => other !== version)
          .map((other) => `https://app.gomega.ai/review-bridge/${other}/review-bridge.js`),
      ]) {
        assert.throws(
          () => parseManagedSiteContractV1(withBridgeDelivery({ version, src: nearMiss })),
          undefined,
          `${version} at ${nearMiss}`,
        );
      }
    }
    // Unsupported versions fail at their own src and at a supported one. v6 is
    // the version most recently dropped, v11 the one not yet promoted.
    for (const version of ["v1", "v3", "v4", "v5", "v6", "v11", "v999", "V10", "v010", "10", "latest", ""]) {
      const ownSrc = `https://app.gomega.ai/review-bridge/${version}/review-bridge.js`;
      for (const src of [ownSrc, BRIDGE_SRC]) {
        assert.throws(
          () => parseManagedSiteContractV1(withBridgeDelivery({ version, src })),
          undefined,
          `${version} at ${src}`,
        );
      }
    }
    for (const integrity of [
      "sha384-abc",
      `sha256-${"a".repeat(64)}`,
      `sha384-${"a".repeat(63)}`,
      `sha384-${"a".repeat(65)}`,
    ]) {
      assert.throws(() => parseManagedSiteContractV1(withBridgeDelivery({ integrity })));
    }
  });

  it("accepts the same bridge deliveries in the JSON Schema artifact as in the parser", () => {
    const cases = [
      ...SUPPORTED_BRIDGE_VERSIONS.map((version) => ({ version, src: bridgeSrcFor(version) })),
      { version: "v8", src: bridgeSrcFor("v7") },
      { version: "v7", src: bridgeSrcFor("v8") },
      { version: "v9", src: bridgeSrcFor("v8") },
      { version: "v8", src: bridgeSrcFor("v9") },
      { version: "v10", src: bridgeSrcFor("v9") },
      { version: "v9", src: bridgeSrcFor("v10") },
      { version: "v11", src: "https://app.gomega.ai/review-bridge/v11/review-bridge.js" },
      { version: "v6", src: "https://app.gomega.ai/review-bridge/v6/review-bridge.js" },
    ];
    for (const patch of cases) {
      const contract = withBridgeDelivery(patch);
      let parses = true;
      try {
        parseManagedSiteContractV1(contract);
      } catch {
        parses = false;
      }
      assert.equal(
        validateManagedSiteContractV1JsonSchema(contract).valid,
        parses,
        `${patch.version} at ${patch.src}`,
      );
    }
  });

  it("accepts only canonical static routes and generated patterns", () => {
    for (const path of ["/", "/about", "/services/gutters-2"]) {
      assert.doesNotThrow(() =>
        parseManagedSiteContractV1(withRoute({ kind: "static", path })),
      );
    }
    for (const pattern of ["/services/[slug]", "/[location]/gutters/[service]"]) {
      assert.doesNotThrow(() =>
        parseManagedSiteContractV1(withRoute(generatedRoute(pattern))),
      );
    }
    const ambiguous = [
      "/../",
      "/./about",
      "/%2e/about",
      "/%252e/about",
      "//about",
      "/white space",
      "/about#team",
      "/%00/about",
      "/bad%escape",
      "/back\\slash",
    ];
    for (const path of ambiguous) {
      assert.throws(() =>
        parseManagedSiteContractV1(withRoute({ kind: "static", path })),
      );
      assert.throws(() =>
        parseManagedSiteContractV1(withRoute(generatedRoute(path))),
      );
    }
    for (const pattern of ["/services", "/services/[slug", "/services/slug]", "/[...slug]", "/{slug}"]) {
      assert.throws(() => parseManagedSiteContractV1(withRoute(generatedRoute(pattern))));
    }
  });

  it("uses one canonical fragment grammar for declarations and destinations", () => {
    for (const fragment of ["contact", "service-area", "faq:item.2"]) {
      const field = linkField();
      (field.constraints as Record<string, unknown>).allowedFragments = [fragment];
      assert.doesNotThrow(() => parseManagedFieldDescriptor(field));
      assert.doesNotThrow(() =>
        validateManagedFieldValue(
          field,
          linkContentValue({
            label: "Jump",
            destination: {
              kind: "internal",
              pageId: stableId("page"),
              fragment,
            },
            target: "same_window",
          }),
        ),
      );
    }
    for (const fragment of ["../", "%2e", "%252e", "two words", "#top", "%00", "%", "bad/part"]) {
      const field = linkField();
      (field.constraints as Record<string, unknown>).allowedFragments = [fragment];
      assert.throws(() => parseManagedFieldDescriptor(field));
    }
  });
});
