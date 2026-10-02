import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  parseManagedSiteContractV1,
} from "../src/index.js";
import { managedSiteContract } from "./schema-fixtures.js";

describe("managed site contract v1", () => {
  it("accepts the exact protocol-1/edit-2 root contract at the promoted delivery", () => {
    const parsed = parseManagedSiteContractV1(managedSiteContract());
    assert.equal(parsed.schemaVersion, "1.0");
    assert.equal(parsed.bridge.reviewProtocol, 1);
    assert.equal(parsed.bridge.editProtocol, 2);
    assert.equal(parsed.bridge.delivery.version, "v10");
  });

  it("rejects unknown root keys, old bridge deliveries, and unsafe URLs", () => {
    assert.throws(() =>
      parseManagedSiteContractV1({ ...managedSiteContract(), ignored: true }),
    );

    const originalBridge = managedSiteContract().bridge as Record<string, unknown>;
    for (const bridgePatch of [
      { editProtocol: 1 },
      {
        delivery: {
          ...(originalBridge.delivery as object),
          version: "v0",
        },
      },
    ]) {
      const input = structuredClone(managedSiteContract());
      input.bridge = { ...(input.bridge as object), ...bridgePatch };
      assert.throws(() => parseManagedSiteContractV1(input));
    }

    const unsafe = structuredClone(managedSiteContract());
    ((unsafe.bridge as Record<string, unknown>).delivery as Record<string, unknown>).src =
      "http://app.gomega.ai/bridge.js";
    assert.throws(() => parseManagedSiteContractV1(unsafe));
  });

  it("supports exact generated-route declarations without resolving references", () => {
    const input = structuredClone(managedSiteContract());
    (input.pages as Record<string, unknown>[])[0].route = {
      kind: "generated",
      pattern: "/services/[slug]",
      collectionId: (input.collections as Record<string, unknown>[])[0].id,
      routeKeyFieldId: ((input.collections as Record<string, unknown>[])[0]
        .itemFields as Record<string, unknown>[])[0].id,
    };
    assert.doesNotThrow(() => parseManagedSiteContractV1(input));
  });
});
