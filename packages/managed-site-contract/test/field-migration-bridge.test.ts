import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ManagedSiteContractV1 } from "../src/contract.js";
import { assertManagedSiteFieldMigrationBridgeV1 } from "../src/field-migration-bridge.js";
import { bridgeSrcFor, parseManagedSiteFieldMigrationV1, type SupportedBridgeVersion } from "../src/index.js";

/**
 * Every bridge descriptor field but the version, src and integrity is a schema
 * literal today, so no PARSED contract can change one. The guard is for the
 * day the schema widens one of them; these contracts skip the parser to reach it.
 */
function contractWith(version: SupportedBridgeVersion, change: Record<string, unknown> = {}): ManagedSiteContractV1 {
  return {
    contractId: "contract_x",
    bridge: {
      reviewProtocol: 1,
      editProtocol: 2,
      annotationVersion: 1,
      framing: "authenticated_preview_gateway",
      delivery: { version, src: bridgeSrcFor(version), integrity: `sha384-${"A".repeat(64)}`, crossOrigin: "anonymous", load: "head_defer" },
      ...change,
    },
  } as unknown as ManagedSiteContractV1;
}

const declaration = parseManagedSiteFieldMigrationV1({
  schemaVersion: "1.0",
  from: { contractSha256: "a".repeat(64), contentSha256: "b".repeat(64) },
  bridge: { from: "v8", to: "v9" },
  steps: [],
});

describe("bridge descriptor beyond the version", () => {
  const cases: readonly [string, Record<string, unknown>][] = [
    ["another framing", { framing: "public" }],
    ["another edit protocol", { editProtocol: 3 }],
    ["another annotation version", { annotationVersion: 2 }],
  ];
  for (const [name, change] of cases) {
    it(`refuses ${name} beside a version step`, () => {
      assert.throws(
        () => assertManagedSiteFieldMigrationBridgeV1(contractWith("v8"), contractWith("v9", change), declaration, () => true),
        { code: "MIGRATION_BRIDGE_DESCRIPTOR_CHANGED" },
      );
    });
  }

  it("admits the version step alone", () => {
    assert.deepEqual(
      assertManagedSiteFieldMigrationBridgeV1(contractWith("v8"), contractWith("v9"), declaration, () => true),
      { from: "v8", to: "v9" },
    );
  });
});
